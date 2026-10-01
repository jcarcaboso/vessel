using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Vessel.Application.Ownership;
using Vessel.Application.Venues;
using Vessel.Application.Workspace;
using Vessel.Domain.Accounts;
using Vessel.Domain.Workspace;
using Vessel.Persistence;

namespace Vessel.Tests;

internal sealed record CoreOwner(Guid OwnerId) : IJournalOwnerContext;

internal sealed class FixtureReader : IPerpetualVenueReader
{
    public string VenueId => "hyperliquid";
    public bool Fail { get; set; }
    public int Reads;
    public PerpetualVenueReadResult Result { get; set; } = new(
        new(DateTimeOffset.Parse("2026-10-01T10:00:00Z"), "primary-perpetual-dex", 1234.1234567890123456789012345m,
            1000.0000000000000000000000001m, 20.123456789012345678901234567m,
            [new("BTC", -0.0123456789012345678901234567m, 60000.123456789m, -1.123456789m, 20.123456789m, 5)]),
        [new("BTC", 5, 50)],
        [new("source-1", "BTC", "B", "Open Long", 60000.123456789m, 0.0000000000000000000000000001m,
            0.00123456789m, "USDC", -0.01m, DateTimeOffset.Parse("2026-10-01T09:00:00Z"), "order-1", "hash-1", "secret raw provider payload")],
        "Recent primary perpetual DEX fills only; incomplete history.");
    public Task<PerpetualVenueReadResult> ReadAsync(string address, CancellationToken ct)
    {
        Interlocked.Increment(ref Reads);
        ct.ThrowIfCancellationRequested();
        return Fail ? Task.FromException<PerpetualVenueReadResult>(new VenueReadException("secret provider failure")) : Task.FromResult(Result);
    }
}

internal sealed class MemoryWorkspaceStore(Guid ownerId) : IWorkspaceStore
{
    public bool RejectOwnerWideReads { get; set; }
    public bool RejectActivityReads { get; set; }
    public List<Portfolio> Portfolios { get; } = [];
    public List<Account> Accounts { get; } = [];
    public List<AccountSnapshot> Snapshots { get; } = [];
    public List<ImportedFill> Fills { get; } = [];
    public Task<List<Portfolio>> PortfoliosAsync(CancellationToken ct) => Task.FromResult(Portfolios.Where(p => p.OwnerId == ownerId).ToList());
    public Task<List<Account>> AccountsAsync(CancellationToken ct) => Task.FromResult(Accounts.Where(a => a.OwnerId == ownerId).ToList());
    public Task<Account?> AccountAsync(Guid id, CancellationToken ct) => Task.FromResult(Accounts.SingleOrDefault(a => a.Id == id && a.OwnerId == ownerId));
    public Task<bool> SourceExistsAsync(string venueId, string address, CancellationToken ct) =>
        Task.FromResult(Accounts.Any(a => a.OwnerId == ownerId && a.VenueId == venueId && a.Address == address));
    public Task<AccountSnapshot?> SnapshotAsync(Guid id, CancellationToken ct) => Task.FromResult(Snapshots.SingleOrDefault(s =>
        s.AccountId == id && s.OwnerId == ownerId && Accounts.Any(a => a.Id == s.AccountId && a.IsEnabled)));
    public Task<List<AccountSnapshot>> SnapshotsAsync(CancellationToken ct) => RejectOwnerWideReads
        ? throw new InvalidOperationException("Owner-wide snapshot read is not allowed in a detail operation.") : Task.FromResult(Snapshots.Where(s => s.OwnerId == ownerId && Accounts.Any(a => a.Id == s.AccountId && a.IsEnabled)).ToList());
    public Task<List<ImportedFill>> FillsAsync(Guid? accountId, int limit, CancellationToken ct) => RejectActivityReads
        ? throw new InvalidOperationException("Activity is not available for collection reads.") : Task.FromResult(Fills.Where(f => f.OwnerId == ownerId && Accounts.Any(a => a.Id == f.AccountId && a.IsEnabled) && (accountId == null || f.AccountId == accountId)).OrderByDescending(f => f.OccurredAtUtc).Take(limit).ToList());
    public Task<int> FillCountAsync(CancellationToken ct) => RejectActivityReads
        ? throw new InvalidOperationException("Activity is not available for collection reads.") : Task.FromResult(Fills.Count(f => f.OwnerId == ownerId && Accounts.Any(a => a.Id == f.AccountId && a.IsEnabled)));
    public Task AddPortfolioAsync(Portfolio portfolio, CancellationToken ct) { Portfolios.Add(portfolio); return Task.CompletedTask; }
    public Task AddAccountAsync(Account account, CancellationToken ct) { Accounts.Add(account); return Task.CompletedTask; }
    public async Task<T> WithAccountLockAsync<T>(Guid id, Func<Account, Task<T>> action, CancellationToken ct) =>
        await action(await AccountAsync(id, ct) ?? throw new WorkspaceException(404, "Account not found."));
    public Task SaveRefreshAsync(Account account, PerpetualVenueReadResult result, CancellationToken ct) => throw new NotSupportedException("Refresh tests use real PostgreSQL.");
    public Task<T> WithManagementLockAsync<T>(Func<Task<T>> action, CancellationToken ct) => action();
    public Task DeletePortfolioAsync(Guid id, CancellationToken ct)
    {
        var portfolio = Portfolios.SingleOrDefault(p => p.Id == id && p.OwnerId == ownerId)
            ?? throw new WorkspaceException(404, "Portfolio not found.");
        foreach (var account in Accounts.Where(a => a.OwnerId == ownerId && a.PortfolioId == id))
            account.UpdateSettings(account.Name, null, account.IsEnabled);
        Portfolios.Remove(portfolio);
        return Task.CompletedTask;
    }
    public Task DeleteAccountAsync(Account account, CancellationToken ct)
    {
        Accounts.Remove(account);
        Snapshots.RemoveAll(s => s.OwnerId == ownerId && s.AccountId == account.Id);
        Fills.RemoveAll(f => f.OwnerId == ownerId && f.AccountId == account.Id);
        return Task.CompletedTask;
    }
    public Task SaveAsync(CancellationToken ct) => Task.CompletedTask;
}

internal sealed class CoreDatabase(string admin, string schema, string connectionString) : IAsyncDisposable
{
    public string ConnectionString => connectionString;
    public VesselDbContext Context(Guid owner) => new(new DbContextOptionsBuilder<VesselDbContext>().UseNpgsql(connectionString).Options, new CoreOwner(owner));
    public static async Task<CoreDatabase> CreateAsync(string? targetMigration = null)
    {
        var admin = Environment.GetEnvironmentVariable("Vessel_TEST_POSTGRES")!;
        var schema = "vessel_test_" + Guid.NewGuid().ToString("N");
        await using var connection = new NpgsqlConnection(admin);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand($"CREATE SCHEMA {schema}", connection);
        await command.ExecuteNonQueryAsync();
        var db = new CoreDatabase(admin, schema, new NpgsqlConnectionStringBuilder(admin) { SearchPath = schema, Pooling = false }.ConnectionString);
        try
        {
            await using var context = db.Context(Guid.NewGuid());
            var migrator = context.GetService<Microsoft.EntityFrameworkCore.Migrations.IMigrator>();
            await migrator.MigrateAsync(targetMigration);
            return db;
        }
        catch { await db.DisposeAsync(); throw; }
    }
    public async ValueTask DisposeAsync()
    {
        await using var connection = new NpgsqlConnection(admin);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand($"DROP SCHEMA {schema} CASCADE", connection);
        await command.ExecuteNonQueryAsync();
    }
}
