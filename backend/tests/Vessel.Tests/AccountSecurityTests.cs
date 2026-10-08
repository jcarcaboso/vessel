using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Vessel.Application.Credentials;
using Vessel.Application.Venues;
using Vessel.Application.Workspace;
using Vessel.Domain.Accounts;
using Vessel.Domain.Credentials;
using Vessel.Infrastructure.Credentials;
using Vessel.Infrastructure.Venues.Hyperliquid;

namespace Vessel.Tests;

public sealed class AccountSecurityTests
{
    [Fact]
    public void Aes_round_trip_random_nonce_and_row_binding()
    {
        using var vault = SecurityFixture.Vault();
        var owner = Guid.NewGuid(); var account = Guid.NewGuid();
        var first = vault.Seal(owner, account, "lighter-read-token", SecurityFixture.Token);
        var second = vault.Seal(owner, account, "lighter-read-token", SecurityFixture.Token);
        Assert.Equal(SecurityFixture.Token, vault.Open(owner, account, "lighter-read-token", first));
        Assert.Equal(12, first.Nonce.Length); Assert.Equal(16, first.Tag.Length);
        Assert.NotEqual(first.Nonce, second.Nonce); Assert.NotEqual(first.Ciphertext, second.Ciphertext);
        Assert.DoesNotContain(SecurityFixture.Token, Encoding.UTF8.GetString(first.Ciphertext));
        Assert.Throws<CredentialStorageException>(() => vault.Open(Guid.NewGuid(), account, "lighter-read-token", first));
        Assert.Throws<CredentialStorageException>(() => vault.Open(owner, Guid.NewGuid(), "lighter-read-token", first));
        Assert.Throws<CredentialStorageException>(() => vault.Open(owner, account, "other-purpose", first));
        first.Tag[0] ^= 1;
        var error = Assert.Throws<CredentialStorageException>(() => vault.Open(owner, account, "lighter-read-token", first));
        Assert.Null(error.InnerException); Assert.DoesNotContain(SecurityFixture.Token, error.ToString());
    }

    [Fact]
    public void Rotation_keeps_old_keys_decrypt_only_and_unknown_keys_are_safe()
    {
        using var old = SecurityFixture.Vault();
        var owner = Guid.NewGuid(); var id = Guid.NewGuid();
        var envelope = old.Seal(owner, id, "lighter-read-token", SecurityFixture.Token);
        using var rotated = new AesGcmCredentialVault(new CredentialSettings
        {
            ActiveKeyId = "v2", Keys = new() { ["v1"] = SecurityFixture.Key, ["v2"] = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)) }
        });
        Assert.Equal(SecurityFixture.Token, rotated.Open(owner, id, "lighter-read-token", envelope));
        Assert.Equal("v2", rotated.Seal(owner, id, "lighter-read-token", SecurityFixture.Token).KeyId);
        Assert.Throws<CredentialStorageException>(() => rotated.Open(owner, id, "lighter-read-token",
            new("lost", envelope.Nonce, envelope.Ciphertext, envelope.Tag)));
    }

    [Fact]
    public void Absent_key_is_unconfigured_but_partial_and_invalid_keys_fail_safely()
    {
        using var absent = new AesGcmCredentialVault(new());
        Assert.False(absent.IsConfigured);
        Assert.Throws<CredentialStorageException>(() => absent.Seal(Guid.NewGuid(), Guid.NewGuid(), "purpose", SecurityFixture.Token));
        foreach (var settings in new[]
        {
            new CredentialSettings { ActiveKeyId = "missing" },
            new CredentialSettings { Keys = new() { ["v1"] = SecurityFixture.Key } },
            new CredentialSettings { ActiveKeyId = "v1", Keys = new() { ["v1"] = SecurityFixture.Token } },
            new CredentialSettings { ActiveKeyId = "v1", Keys = new() { ["v1"] = Convert.ToBase64String(new byte[16]) } }
        })
        {
            var error = Assert.Throws<CredentialStorageException>(() => new AesGcmCredentialVault(settings));
            Assert.DoesNotContain(SecurityFixture.Token, error.ToString()); Assert.DoesNotContain(SecurityFixture.Key, error.ToString());
        }
    }

    [Fact]
    public void Startup_validation_does_not_echo_malformed_key()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Vessel:Credentials:ActiveKeyId"] = "v1", ["Vessel:Credentials:Keys:v1"] = SecurityFixture.Token
        }).Build();
        var services = new ServiceCollection().AddVesselCredentials(config);
        using var provider = services.BuildServiceProvider();
        var error = Assert.Throws<OptionsValidationException>(() => provider.GetRequiredService<IStartupValidator>().Validate());
        Assert.DoesNotContain(SecurityFixture.Token, error.ToString());
    }

    [Fact]
    public void Mode_600_file_works_and_loose_permissions_and_symlinks_fail()
    {
        if (OperatingSystem.IsWindows()) return;
        var directory = Path.Combine(Path.GetTempPath(), "vessel-key-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var file = Path.Combine(directory, "keys.json");
        try
        {
            File.WriteAllText(file, JsonSerializer.Serialize(new { ActiveKeyId = "v1", Keys = new Dictionary<string, string> { ["v1"] = SecurityFixture.Key } }));
            File.SetUnixFileMode(file, UnixFileMode.UserRead | UnixFileMode.UserWrite);
            using (var vault = new AesGcmCredentialVault(new() { KeyFile = file })) Assert.True(vault.IsConfigured);
            var link = Path.Combine(directory, "link.json"); File.CreateSymbolicLink(link, file);
            Assert.Throws<CredentialStorageException>(() => new AesGcmCredentialVault(new() { KeyFile = link }));
            File.SetUnixFileMode(file, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.GroupRead);
            Assert.Throws<CredentialStorageException>(() => new AesGcmCredentialVault(new() { KeyFile = file }));
        }
        finally { Directory.Delete(directory, true); }
    }

    [Theory]
    [InlineData("0")]
    [InlineData("9007199254740993")]
    [InlineData("9223372036854775807")]
    public async Task Account_index_is_an_exact_string(string source)
    {
        var owner = Guid.NewGuid(); var store = new MemoryWorkspaceStore(owner);
        var service = new WorkspaceService(store, new CoreOwner(owner), SecurityFixture.Registry());
        var created = await service.CreateAccountAsync(new(null, "Lighter", SecurityFixture.Venue.Id, SourceId: source), default);
        Assert.Equal(source, created.SourceId); Assert.Null(created.Address); Assert.Equal(source, store.Accounts.Single().SourceId);
    }

    [Theory]
    [InlineData(null)] [InlineData("")] [InlineData("00")] [InlineData("0123")] [InlineData("+1")] [InlineData("-1")]
    [InlineData("1.0")] [InlineData("1e3")] [InlineData(" 1")] [InlineData("1 ")] [InlineData("１２")]
    [InlineData("9223372036854775808")]
    public async Task Invalid_account_indices_do_not_create_accounts(string? source)
    {
        var owner = Guid.NewGuid(); var store = new MemoryWorkspaceStore(owner);
        var service = new WorkspaceService(store, new CoreOwner(owner), SecurityFixture.Registry());
        var error = await Assert.ThrowsAsync<WorkspaceException>(() => service.CreateAccountAsync(new(null, "Account", SecurityFixture.Venue.Id, SourceId: source), default));
        Assert.Equal(400, error.StatusCode); Assert.Empty(store.Accounts);
    }

    [Fact]
    public async Task Address_compatibility_and_conflicting_source_checks()
    {
        var owner = Guid.NewGuid(); var store = new MemoryWorkspaceStore(owner);
        var service = new WorkspaceService(store, new CoreOwner(owner), SecurityFixture.Registry());
        var address = "0x" + new string('A', 40);
        var account = await service.CreateAccountAsync(new(null, "EVM", "hyperliquid", Address: address), default);
        Assert.Equal(address.ToLowerInvariant(), account.Address); Assert.Equal(account.Address, account.SourceId);
        var error = await Assert.ThrowsAsync<WorkspaceException>(() => service.CreateAccountAsync(new(null, "EVM", "hyperliquid", Address: address, SourceId: "0x" + new string('b', 40)), default));
        Assert.Equal(400, error.StatusCode);
        await Assert.ThrowsAsync<WorkspaceException>(() => service.CreateAccountAsync(new(null, "Lighter", SecurityFixture.Venue.Id, Address: address, SourceId: "1"), default));
    }

    [Fact]
    public async Task Discovery_overlays_only_owner_records_including_disabled_and_preserves_exact_balance()
    {
        var owner = Guid.NewGuid(); var store = new MemoryWorkspaceStore(owner);
        var added = SecurityFixture.Account(owner, "9223372036854775807"); added.UpdateSettings(added.Name, null, false); store.Accounts.Add(added);
        store.Accounts.Add(SecurityFixture.Account(Guid.NewGuid(), "2"));
        var discovery = new SecurityDiscovery([new("9223372036854775807", "Main", "main", "-12.000000000000000000001",
            "15.000000000000000001", "-0.01"), new("2", "Sub", "subaccount")]);
        var service = new AccountDiscoveryService(store, new CoreOwner(owner), SecurityFixture.Registry(), [discovery]);
        var result = await service.DiscoverAsync(SecurityFixture.Venue.Id, SecurityFixture.Address, default);
        Assert.Equal(added.Id, result.Accounts[0].ExistingAccountId); Assert.False(result.Accounts[0].IsEnabled);
        Assert.Equal("-12.000000000000000000001", result.Accounts[0].AccountValueUsd);
        Assert.Equal("15.000000000000000001", result.Accounts[0].CollateralUsd);
        Assert.Equal("-0.01", result.Accounts[0].AvailableBalanceUsd);
        Assert.Null(result.Accounts[1].ExistingAccountId); Assert.Null(result.Accounts[1].IsEnabled);
        Assert.Equal(2, store.Accounts.Count);
    }

    [Fact]
    public async Task Credential_metadata_never_contains_secrets_and_unavailable_storage_allows_delete()
    {
        var owner = Guid.NewGuid(); var store = new MemoryWorkspaceStore(owner); var account = SecurityFixture.Account(owner); store.Accounts.Add(account);
        var credentials = new SecurityCredentialStore(); using var vault = SecurityFixture.Vault();
        var service = SecurityFixture.Service(owner, store, credentials, vault);
        var saved = await service.PutAsync(account.Id, new() { Token = SecurityFixture.Token }, default);
        Assert.Equal("valid", saved.Credential!.Status); Assert.True(saved.StorageConfigured);
        var json = JsonSerializer.Serialize(saved);
        Assert.DoesNotContain(SecurityFixture.Token, json); Assert.DoesNotContain("Ciphertext", json); Assert.DoesNotContain("KeyId", json);
        var reader = new AccountCredentialReader(store, credentials, new CoreOwner(owner), vault, SecurityFixture.Clock);
        Assert.Equal(SecurityFixture.Token, await reader.ReadAsync(account.Id, default));
        using var absent = new AesGcmCredentialVault(new());
        var unavailable = SecurityFixture.Service(owner, store, credentials, absent);
        Assert.Equal("unavailable", (await unavailable.GetAsync(account.Id, default)).Credential!.Status);
        Assert.Equal(503, (await Assert.ThrowsAsync<WorkspaceException>(() => unavailable.PutAsync(account.Id, new() { Token = SecurityFixture.Token }, default))).StatusCode);
        await unavailable.DeleteAsync(account.Id, default); Assert.Null(credentials.Stored);
    }

    [Fact]
    public async Task Expiring_expired_disabled_foreign_and_verification_failure_are_safe()
    {
        var owner = Guid.NewGuid(); var store = new MemoryWorkspaceStore(owner); var account = SecurityFixture.Account(owner); store.Accounts.Add(account);
        var credentials = new SecurityCredentialStore(); using var vault = SecurityFixture.Vault();
        var verifier = new SecurityVerifier { Expiry = SecurityFixture.Now.AddDays(7) };
        var service = SecurityFixture.Service(owner, store, credentials, vault, verifier);
        Assert.Equal("expiring", (await service.PutAsync(account.Id, new() { Token = SecurityFixture.Token }, default)).Credential!.Status);
        verifier.Error = new WorkspaceException(400, SecurityFixture.Token);
        var error = await Assert.ThrowsAsync<WorkspaceException>(() => service.PutAsync(account.Id, new() { Token = "replacement" }, default));
        Assert.DoesNotContain(SecurityFixture.Token, error.ToString()); Assert.Equal(SecurityFixture.Now.AddDays(7), credentials.Stored!.ExpiresAt);
        credentials.Stored.ExpiresAt = SecurityFixture.Now;
        Assert.Equal("expired", (await service.GetAsync(account.Id, default)).Credential!.Status);
        var reader = new AccountCredentialReader(store, credentials, new CoreOwner(owner), vault, SecurityFixture.Clock);
        Assert.Null(await reader.ReadAsync(account.Id, default));
        account.UpdateSettings(account.Name, null, false);
        Assert.Equal(409, (await Assert.ThrowsAsync<WorkspaceException>(() => reader.ReadAsync(account.Id, default))).StatusCode);
        Assert.Equal(409, (await Assert.ThrowsAsync<WorkspaceException>(() => service.PutAsync(account.Id, new() { Token = SecurityFixture.Token }, default))).StatusCode);
        Assert.NotNull((await service.GetAsync(account.Id, default)).Credential);
        Assert.Equal(404, (await Assert.ThrowsAsync<WorkspaceException>(() => service.GetAsync(Guid.NewGuid(), default))).StatusCode);
    }

    [Fact]
    public async Task Usable_status_reads_metadata_only_and_matches_reader_rules()
    {
        var owner = Guid.NewGuid(); var store = new MemoryWorkspaceStore(owner); var account = SecurityFixture.Account(owner); store.Accounts.Add(account);
        var credentials = new SecurityCredentialStore(); using var vault = SecurityFixture.Vault();
        await SecurityFixture.Service(owner, store, credentials, vault).PutAsync(account.Id, new() { Token = SecurityFixture.Token }, default);
        var reader = new AccountCredentialReader(store, credentials, new CoreOwner(owner), vault, SecurityFixture.Clock);
        Assert.True(await reader.IsUsableAsync(account, default));
        using var rotated = new Vessel.Infrastructure.Credentials.AesGcmCredentialVault(new() { ActiveKeyId = "v2", Keys = new() { ["v2"] = SecurityFixture.Key } });
        Assert.False(await new AccountCredentialReader(store, credentials, new CoreOwner(owner), rotated, SecurityFixture.Clock).IsUsableAsync(account, default));
        Assert.False(await new AccountCredentialReader(store, credentials, new CoreOwner(Guid.NewGuid()), vault, SecurityFixture.Clock).IsUsableAsync(account, default));
        credentials.Stored!.ExpiresAt = SecurityFixture.Now;
        Assert.False(await reader.IsUsableAsync(account, default));
        credentials.Stored.ExpiresAt = SecurityFixture.Now.AddDays(1);
        account.UpdateSettings(account.Name, null, false);
        Assert.False(await reader.IsUsableAsync(account, default));
    }
}

internal static class SecurityFixture
{
    public const string Token = "ro:123:single:1999999999:abcdef1234567890";
    public static readonly string Key = Convert.ToBase64String(Enumerable.Repeat((byte)83, 32).ToArray());
    public static readonly DateTimeOffset Now = new(2026, 10, 7, 12, 0, 0, TimeSpan.Zero);
    public static readonly TimeProvider Clock = new SecurityClock();
    public static readonly string Address = "0x" + new string('a', 40);
    public static readonly VenueDescriptor Venue = new("index-fixture", "Index venue", "read-only", VenueSources.AccountIndex,
        new(true, false, true, false, false, false, false, AccountDiscovery: true, ReadOnlyCredential: true));
    public static VenueRegistry Registry(params object[] adapters) => new([VenueDescriptor.Manual, HyperliquidPerpetualReader.Descriptor, Venue],
        adapters.OfType<IPerpetualVenueReader>(), adapters.OfType<IVenueOrderReader>(), [], [], []);
    public static AesGcmCredentialVault Vault() => new(new() { ActiveKeyId = "v1", Keys = new() { ["v1"] = Key } });
    public static Account Account(Guid owner, string source = "123")
    {
        var account = new Account(Guid.NewGuid(), owner, Venue.Id, "Index account"); account.Configure(null, null, null, source); return account;
    }
    public static AccountCredentialService Service(Guid owner, IWorkspaceStore accounts, IAccountCredentialStore credentials, ICredentialVault vault, SecurityVerifier? verifier = null) =>
        new(accounts, credentials, new CoreOwner(owner), Registry(), [verifier ?? new()], vault, Clock);
    private sealed class SecurityClock : TimeProvider { public override DateTimeOffset GetUtcNow() => Now; }
}

internal sealed class SecurityVerifier : IVenueCredentialVerifier
{
    public string VenueId => SecurityFixture.Venue.Id;
    public Exception? Error { get; set; }
    public DateTimeOffset Expiry { get; set; } = SecurityFixture.Now.AddDays(60);
    public Task<VerifiedVenueCredential> VerifyAsync(string sourceId, string token, CancellationToken cancellationToken) =>
        Error is { } error ? Task.FromException<VerifiedVenueCredential>(error) : Task.FromResult(new VerifiedVenueCredential("single", Expiry));
}

internal sealed class SecurityDiscovery(IReadOnlyList<VenueAccountCandidate> candidates) : IVenueAccountDiscovery
{
    public string VenueId => SecurityFixture.Venue.Id;
    public string? ReceivedToken { get; private set; }
    public Exception? Error { get; init; }
    public Task<IReadOnlyList<VenueAccountCandidate>> DiscoverAsync(string address, CancellationToken cancellationToken) => Task.FromResult(candidates);
    public Task<IReadOnlyList<VenueAccountCandidate>> DiscoverAsync(string address, string token, CancellationToken cancellationToken)
    {
        ReceivedToken = token;
        return Error is { } error ? Task.FromException<IReadOnlyList<VenueAccountCandidate>>(error) : Task.FromResult(candidates);
    }
}

internal sealed class SecurityCredentialStore : IAccountCredentialStore
{
    internal AccountCredential? Stored { get; set; }
    public Task<AccountCredential?> FindAsync(Guid accountId, string purpose, CancellationToken ct) => Task.FromResult(Stored?.AccountId == accountId && Stored.Purpose == purpose ? Stored : null);
    public Task SaveAsync(AccountCredential credential, CancellationToken ct) { Stored = credential; return Task.CompletedTask; }
    public Task DeleteAsync(Guid accountId, string purpose, CancellationToken ct) { Stored = null; return Task.CompletedTask; }
}
