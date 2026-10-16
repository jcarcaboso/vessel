using Microsoft.EntityFrameworkCore;
using Vessel.Application.Common;
using Vessel.Application.Venues;
using Vessel.Application.Workspace;
using Vessel.Domain.Accounts;
using Vessel.Domain.Workspace;
using Vessel.Persistence;

namespace Vessel.Tests;

public sealed class FundingPostgresTests
{
    private static readonly DateTimeOffset At = new(2026, 10, 16, 12, 0, 0, TimeSpan.Zero);
    private sealed class Reader : IPerpetualVenueReader, IVenueFundingReader
    {
        public string VenueId => "hyperliquid";
        public bool FailFunding, CancelFunding;
        public int FundingReads;
        public decimal Amount = -0.1234567890123456789012345678m;
        public DateTimeOffset Observation = At;
        public VenueFundingReadResult? Funding;
        public Task<IReadOnlyList<VenueInstrument>> ReadInstrumentsAsync(CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<VenueInstrument>>([]);
        public Task<PerpetualVenueReadResult> ReadAsync(string source, CancellationToken ct) =>
            Task.FromResult(new PerpetualVenueReadResult(new(Observation, "fixture", 100, 80, 0, []), [], [], "Synthetic bounded executions."));
        public Task<VenueFundingReadResult> ReadFundingAsync(Account account, DateTimeOffset from, DateTimeOffset to, CancellationToken ct)
        {
            FundingReads++;
            if (CancelFunding) throw new OperationCanceledException(ct);
            if (FailFunding) throw new VenueReadException("Provider secret must not appear.");
            return Task.FromResult(Funding ?? new([new("funding-1", "BTC", "1", Amount, "USDC", At.AddDays(-1),
                "Raw payload must not be stored")], from, to, true, "Synthetic settled funding.", FundingFacts.Excluded));
        }
    }
    private static WorkspaceService Service(VesselDbContext db, Guid owner, Reader reader) =>
        new(new WorkspaceStore(db), new CoreOwner(owner), TestVenues.With(reader));
    private static async Task<Guid> Account(VesselDbContext db, Guid owner)
    {
        var account = new Account(Guid.NewGuid(), owner, "hyperliquid", "Synthetic funding");
        account.Configure(null, "0x1111111111111111111111111111111111111111", null);
        db.Accounts.Add(account); await db.SaveChangesAsync();
        return account.Id;
    }

    [PostgresFact]
    public async Task Migration_owner_isolation_concurrent_sync_dedup_exact_money_and_delete()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid(); var reader = new Reader(); Guid id;
        await using (var db = database.Context(owner))
        {
            Assert.False(db.Database.HasPendingModelChanges());
            id = await Account(db, owner);
        }
        await Task.WhenAll(Enumerable.Range(0, 3).Select(async _ =>
        {
            await using var db = database.Context(owner);
            await Service(db, owner, reader).SyncAsync(id, default);
        }));
        await using (var db = database.Context(owner))
        {
            var payment = await db.FundingPayments.SingleAsync();
            Assert.Equal(reader.Amount, payment.Amount);
            Assert.Equal(At.AddDays(-30), (await db.FundingStates.SingleAsync()).CoveredFromUtc);
            Assert.Equal(At, (await db.FundingStates.SingleAsync()).CoveredToUtc);
            Assert.DoesNotContain(db.Model.FindEntityType(typeof(FundingPayment))!.GetProperties(), p => p.Name.Contains("Raw"));
        }
        await using (var db = database.Context(Guid.NewGuid()))
        {
            Assert.Empty(await db.FundingPayments.ToListAsync()); Assert.Empty(await db.FundingStates.ToListAsync());
        }
        await using (var db = database.Context(owner))
        {
            await Service(db, owner, reader).DeleteAccountAsync(id, default);
            Assert.Empty(await db.FundingPayments.ToListAsync()); Assert.Empty(await db.FundingStates.ToListAsync());
            Assert.Empty(await db.Accounts.ToListAsync());
        }
    }

    [PostgresFact]
    public async Task Conflicting_funding_identity_rolls_back_the_entire_refresh_without_overwriting_facts()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid(); var reader = new Reader(); Guid id;
        await using (var db = database.Context(owner))
        {
            id = await Account(db, owner); await Service(db, owner, reader).SyncAsync(id, default);
        }
        var original = reader.Amount;
        reader.Amount = 50; reader.Observation = At.AddHours(1);
        await using (var db = database.Context(owner))
        {
            var error = await Assert.ThrowsAsync<ProblemException>(() => Service(db, owner, reader).SyncAsync(id, default));
            Assert.Equal(409, error.StatusCode);
        }
        await using (var db = database.Context(owner))
        {
            Assert.Equal(original, (await db.FundingPayments.SingleAsync()).Amount);
            Assert.Equal(At, (await db.Snapshots.SingleAsync()).ObservedAtUtc);
            Assert.Equal(At, (await db.FundingStates.SingleAsync()).CoveredToUtc);
        }
    }

    [PostgresFact]
    public async Task Funding_failure_preserves_history_and_valid_snapshot_refresh_without_exposing_provider_errors()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid(); var reader = new Reader(); Guid id;
        await using (var db = database.Context(owner))
        {
            id = await Account(db, owner); await Service(db, owner, reader).SyncAsync(id, default);
            reader.FailFunding = true; reader.Observation = At.AddHours(1);
            await Service(db, owner, reader).SyncAsync(id, default);
        }
        await using (var db = database.Context(owner))
        {
            Assert.Single(await db.FundingPayments.ToListAsync());
            var state = await db.FundingStates.SingleAsync();
            Assert.False(state.LastReadComplete); Assert.Equal(At, state.CoveredToUtc);
            Assert.DoesNotContain("secret", state.Notice, StringComparison.OrdinalIgnoreCase);
            Assert.Equal(At.AddHours(1), (await db.Snapshots.SingleAsync()).ObservedAtUtc);
        }
    }

    [PostgresFact]
    public async Task Coverage_merges_overlaps_but_does_not_bridge_an_unread_gap_and_keeps_settlements()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid(); var reader = new Reader(); Guid id;
        await using (var db = database.Context(owner))
        {
            id = await Account(db, owner); await Service(db, owner, reader).SyncAsync(id, default);
            reader.Observation = At.AddDays(1);
            await Service(db, owner, reader).SyncAsync(id, default);
            Assert.Equal(At.AddDays(-30), (await db.FundingStates.SingleAsync()).CoveredFromUtc);
            Assert.Equal(At.AddDays(1), (await db.FundingStates.SingleAsync()).CoveredToUtc);
            reader.Observation = At.AddDays(40);
            reader.Funding = new([], At.AddDays(10), At.AddDays(40), true, "Later verified empty window.", FundingFacts.Excluded);
            await Service(db, owner, reader).SyncAsync(id, default);
        }
        await using (var db = database.Context(owner))
        {
            var state = await db.FundingStates.SingleAsync();
            Assert.Equal(At.AddDays(10), state.CoveredFromUtc); Assert.Equal(At.AddDays(40), state.CoveredToUtc);
            Assert.Single(await db.FundingPayments.ToListAsync());
        }
    }

    [PostgresFact]
    public async Task Native_nanoseconds_round_trip_separately_from_the_postgres_microsecond_timestamp()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid(); var reader = new Reader(); Guid id;
        const long ns = 1792144800001234567;
        var timestamp = DateTimeOffset.UnixEpoch.AddTicks(ns / 1000 * 10);
        reader.Funding = new([new VenueFundingPayment("ns-payment", "BTC", "1", 2, "USDC", timestamp, "{}")
        { OccurredAtUnixNanoseconds = ns }], At.AddDays(-30), At, true, "Exact native timestamp.");
        await using (var db = database.Context(owner))
        {
            id = await Account(db, owner); await Service(db, owner, reader).SyncAsync(id, default);
        }
        await using (var db = database.Context(owner))
        {
            var payment = await db.FundingPayments.SingleAsync();
            Assert.Equal(ns, payment.OccurredAtUnixNanoseconds); Assert.Equal(timestamp, payment.OccurredAtUtc);
            await Service(db, owner, reader).SyncAsync(id, default);
            Assert.Single(await db.FundingPayments.ToListAsync());
        }
    }

    [PostgresFact]
    public async Task Cancelled_funding_never_saves_the_refresh_and_disabled_accounts_never_read()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid(); var reader = new Reader { CancelFunding = true }; Guid id;
        using var cancellation = new CancellationTokenSource();
        await using (var db = database.Context(owner))
        {
            id = await Account(db, owner);
            cancellation.Cancel();
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Service(db, owner, reader).SyncAsync(id, cancellation.Token));
        }
        await using (var db = database.Context(owner))
        {
            Assert.Empty(await db.FundingPayments.ToListAsync()); Assert.Empty(await db.Snapshots.ToListAsync());
            var account = await db.Accounts.SingleAsync(); account.UpdateSettings(account.Name, null, false); await db.SaveChangesAsync();
            await Assert.ThrowsAsync<ProblemException>(() => Service(db, owner, reader).SyncAsync(id, default));
            Assert.Equal(0, reader.FundingReads);
        }
    }

    [PostgresFact]
    public async Task Retrospective_preview_uses_the_same_funding_aware_native_partition_as_activity()
    {
        await using var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid(); Guid id; Guid openingId;
        await using (var db = database.Context(owner))
        {
            id = await Account(db, owner);
            var account = await db.Accounts.SingleAsync();
            var legacy = DiaryPostgresTests.Imported(account, "legacy", "legacy", "buy", "open", 1, 100, 0);
            var open = DiaryPostgresTests.Imported(account, "native-entry", "native-entry", "buy", "open", 1, 100, 1);
            var close = DiaryPostgresTests.Imported(account, "native-exit", "native-exit", "sell", "close", 1, 110, 2, 10);
            open.VenueContractId = "1"; close.VenueContractId = "1"; openingId = open.Id;
            db.Fills.AddRange(legacy, open, close);
            db.Orders.AddRange(DiaryPostgresTests.Order(account, "native-entry", "buy", 1),
                DiaryPostgresTests.Order(account, "native-exit", "sell", 1));
            // A second native market known only through funding makes the old unqualified execution ambiguous.
            db.FundingPayments.Add(new() { Id = Guid.NewGuid(), OwnerId = owner, AccountId = id, ContractId = "BTC",
                VenueContractId = "2", SourceId = "retired-market-payment", Amount = 1, Asset = "USDC",
                OccurredAtUtc = open.OccurredAtUtc.AddMilliseconds(500) });
            db.Snapshots.Add(new() { OwnerId = owner, AccountId = id, ObservedAtUtc = close.OccurredAtUtc.AddSeconds(1), ValueScope = "fixture" });
            await db.SaveChangesAsync();
        }
        await using (var db = database.Context(owner))
        {
            var activity = await ActivityTestSupport.Activity(db).PageAsync(id);
            var operation = Assert.Single(activity.Operations, o => o.Status == "closed");
            Assert.StartsWith(openingId.ToString(), operation.Id);
            var preview = await DiaryPostgresTests.Service(db).PreviewAsync(id, operation.Id, default);
            Assert.Equal(operation.Id, preview.Operation.Id);
            Assert.Equal(2, preview.Operation.Fills.Count);
            Assert.DoesNotContain(preview.Operation.Fills, f => f.Fill.SourceFillId == "legacy");
        }
    }
}
