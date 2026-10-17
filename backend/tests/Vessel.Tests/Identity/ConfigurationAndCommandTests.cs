using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Nethereum.Signer;
using Vessel.Application.Ownership;
using Vessel.Identity;

namespace Vessel.Tests.Identity;

public sealed class ConfigurationAndCommandTests
{
    private static IConfiguration Config(Dictionary<string, string?>? overrides = null) =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Vessel:Auth:Mode"] = "Wallet", ["Vessel:Auth:OwnerId"] = Guid.NewGuid().ToString(),
            ["Vessel:Identity:Origins:0"] = "https://vessel.test"
        }.Concat(overrides ?? []).GroupBy(x => x.Key).ToDictionary(x => x.Key, x => x.Last().Value)).Build();

    [Theory]
    [InlineData("Vessel:Auth:Mode", "wallet")]
    [InlineData("Vessel:Auth:Token", "synthetic-must-never-echo")]
    [InlineData("Vessel:Auth:OwnerId", null)]
    [InlineData("Vessel:Auth:OwnerId", "11111111-1111-1111-1111-111111111111")]
    [InlineData("Vessel:Identity:Origins:0", "http://localhost")]
    [InlineData("Vessel:Identity:Origins:0", "https://vessel.test/path")]
    [InlineData("Vessel:Identity:Origins:0", null)]
    [InlineData("Vessel:Identity:Schema", "unsafe-schema")]
    [InlineData("Vessel:Identity:Registration", "unknown")]
    [InlineData("Vessel:Identity:Session:IdleHours", "25")]
    [InlineData("Vessel:Identity:Session:RememberIdleDays", "31")]
    [InlineData("Vessel:Identity:MaxSessionsPerUser", "201")]
    [InlineData("Vessel:Identity:MaxPendingRegistrations", "0")]
    [InlineData("Vessel:Identity:CookieName", "not-host-prefixed")]
    [InlineData("Vessel:Identity:SignInCookieName", "__Host-vessel-session")]
    [InlineData("Vessel:Events:MaxStreams", "0")]
    public void Wallet_mode_rejects_invalid_configuration_without_values(string key, string? value)
    {
        var error = Assert.ThrowsAny<Exception>(() => IdentitySettings.Read(Config(new() { [key] = value }), false));
        Assert.DoesNotContain("synthetic-must-never-echo", error.Message);
    }

    [Fact]
    public void Origins_are_normalized_and_registration_is_gated_and_default_owner_is_token_compatible()
    {
        var settings = IdentitySettings.Read(Config(new() { ["Vessel:Identity:Origins:0"] = "https://VESSEL.test:443/" }), false);
        Assert.Equal("https://vessel.test", Assert.Single(settings.Origins));
        Assert.Equal("Closed", settings.Registration);
        Assert.False(IdentityRegistrationGate.MultiOwnerReady);
        var token = IdentitySettings.Read(Config(new()
        {
            ["Vessel:Auth:Mode"] = "Token", ["Vessel:Auth:OwnerId"] = null, ["Vessel:Identity:Origins:0"] = null
        }), false);
        Assert.Equal(JournalOwner.Default, token.OwnerId);
        Assert.False(token.WalletMode);
        _ = IdentitySettings.Read(Config(new()
        {
            ["Vessel:Auth:OwnerId"] = JournalOwner.Default.ToString(), ["Vessel:Identity:AllowLegacyDefaultOwner"] = "true"
        }), false);
    }

    [Fact]
    public async Task Ensure_owner_in_Token_mode_does_not_touch_a_database_or_require_nondefault_owner()
    {
        var output = new StringWriter();
        var config = Config(new()
        {
            ["Vessel:Auth:Mode"] = "Token", ["Vessel:Auth:OwnerId"] = JournalOwner.Default.ToString(),
            ["ConnectionStrings:Vessel"] = null
        });
        Assert.Equal(0, await IdentityCommands.RunAsync(["ensure-owner"], config, false, output));
        Assert.Contains("Token mode", output.ToString());
        Assert.Equal(2, await IdentityCommands.RunAsync(["unknown"], config, false, output));
    }

    [Fact]
    public async Task Command_line_configuration_is_effective_and_malformed_command_options_are_usage_errors()
    {
        var output = new StringWriter();
        Assert.Equal(0, await IdentityCommands.RunAsync(["ensure-owner", "--Vessel:Auth:Mode=Token"], output));
        Assert.Contains("Token mode", output.ToString());
        Assert.Equal(2, await IdentityCommands.RunAsync(["bind-wallet", "--user"], output));
        Assert.Equal(2, await IdentityCommands.RunAsync(["ensure-owner", "--Vessel:Auth:Mode"], output));
    }

    [PostgresFact]
    public async Task Bootstrap_bind_and_invite_are_idempotent_safe_and_return_documented_exit_codes()
    {
        await using var database = await IdentityDatabase.CreateAsync();
        var owner = Guid.NewGuid();
        var config = database.Configuration(owner);
        var output = new StringWriter();
        Assert.Equal(0, await IdentityCommands.RunAsync(["ensure-owner"], config, true, output));
        Assert.Equal(0, await IdentityCommands.RunAsync(["ensure-owner"], config, true, output));
        await using var db = database.CreateDbContext();
        var user = await db.Users.SingleAsync();
        Assert.Equal(owner, user.Id);
        Assert.Equal("operator", user.Role);
        Assert.Equal("active", user.Status);
        var key = EthECKey.GenerateKey();
        string[] bind = ["bind-wallet", "--user", owner.ToString(), "--address", key.GetPublicAddress(), "--label", "Recovery"];
        Assert.Equal(0, await IdentityCommands.RunAsync(bind, config, true, output));
        Assert.Equal(0, await IdentityCommands.RunAsync(bind, config, true, output));
        Assert.Single(await db.Wallets.ToListAsync());
        Assert.Equal(3, await IdentityCommands.RunAsync(
            ["bind-wallet", "--user", Guid.NewGuid().ToString(), "--address", key.GetPublicAddress()], config, true, output));
        Assert.Equal(2, await IdentityCommands.RunAsync(["bind-wallet", "--user", "not-a-guid", "--address", key.GetPublicAddress()], config, true, output));
        var invitation = new StringWriter();
        Assert.Equal(0, await IdentityCommands.RunAsync(["invite", "--note", "Synthetic", "--expires", "2d", "--max-uses", "2"], config, true, invitation));
        var code = invitation.ToString().Trim();
        Assert.StartsWith("VSL-", code);
        var stored = await db.Invitations.SingleAsync();
        Assert.Equal(IdentityTokens.Hash(InvitationCodes.Normalize(code)), stored.CodeHash);
        Assert.Equal(2, stored.MaxUses);
        Assert.Equal(TimeSpan.FromDays(2), stored.ExpiresAt - stored.CreatedAt);
        Assert.Equal(2, await IdentityCommands.RunAsync(["invite", "--expires", "-1d"], config, true, output));
        var legacy = database.ConfigurationValues(JournalOwner.Default);
        legacy["Vessel:Identity:AllowLegacyDefaultOwner"] = "true";
        legacy["Vessel:Identity:Origins:1"] = null;
        Assert.Equal(0, await IdentityCommands.RunAsync(["ensure-owner"],
            new ConfigurationBuilder().AddInMemoryCollection(legacy).Build(), false, output));
        Assert.True(await db.Users.AnyAsync(x => x.Id == JournalOwner.Default));
        Assert.Contains("AllowLegacyDefaultOwner", output.ToString());
    }

    [Fact]
    public async Task Default_GUID_refusal_and_override_apply_only_in_Wallet_mode()
    {
        var output = new StringWriter();
        Assert.Equal(1, await IdentityCommands.RunAsync(["ensure-owner"], Config(new()
            { ["Vessel:Auth:OwnerId"] = JournalOwner.Default.ToString() }), false, output));
        Assert.Contains("Vessel:Auth:OwnerId", output.ToString());
    }

    [Fact]
    public void Migration_script_keeps_argument_forwarding_only_on_the_journal_bundle()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "deploy", "migrate"))) directory = directory.Parent;
        Assert.NotNull(directory);
        var script = File.ReadAllText(Path.Combine(directory.FullName, "deploy", "migrate"));
        var expected = new[] { "/app/migrate-identity-ef\n", "/app/migrate-ef \"$@\"", "Vessel.Api.dll identity ensure-owner", "Vessel.Api.dll provision-messaging" };
        var previous = -1;
        foreach (var step in expected) { var index = script.IndexOf(step, StringComparison.Ordinal); Assert.True(index > previous); previous = index; }
        Assert.Contains("set -eu", script);
    }
}
