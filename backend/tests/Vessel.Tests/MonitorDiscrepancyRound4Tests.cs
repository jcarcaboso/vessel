using Microsoft.EntityFrameworkCore;
using Vessel.Application.Credentials;
using Vessel.Application.Events;
using Vessel.Application.Monitoring;
using Vessel.Application.Ownership;
using Vessel.Application.Plays;
using Vessel.Application.Venues;
using Vessel.Domain.Accounts;
using Vessel.Domain.Markets;
using Vessel.Domain.Monitoring;
using Vessel.Domain.Plays;
using Vessel.Persistence;

namespace Vessel.Tests;

/// <summary>Fourth review round for PR #46: real expiry of unobservable discrepancy work.</summary>
public sealed class MonitorDiscrepancyRound4Tests
{
    private static readonly int Lifetime = (int)TimeSpan.FromDays(7).TotalSeconds;

    [Fact] // Finding 2
    public async Task Unchanged_evidence_after_dismissing_an_unverifiable_candidate_stays_dismissed()
    {
        var f = Untracked();
        await f.Evaluate();
        var row = f.Store.Rows.Single(x => x.Kind == "position.excess" && x.State == "candidate");
        Assert.NotEmpty(row.Fingerprint);
        Assert.Contains("\"venueQuantity\":\"1\"", row.Details);
        f.Retired = true; f.Advance(Lifetime + 60); await f.Evaluate();
        await f.Service.DismissAsync(f.Account.Id, null, row.Id, null, default);
        f.Retired = false;
        f.Advance(60); await f.Confirm();
        Assert.Equal("dismissed", row.State);
        Assert.DoesNotContain(f.Events.Items, x => x.Type == "discrepancy.opened");
        // Changed evidence still re-arms it.
        f.Position = 2; f.Advance(60); await f.Confirm();
        Assert.Equal("open", row.State);
    }

    [Fact] // Finding 3
    public async Task Expired_recurrence_of_a_resolved_record_is_unverifiable_and_keeps_its_resolution()
    {
        var f = Untracked();
        await f.Confirm();
        var row = f.Store.Rows.Single(x => x.Kind == "position.excess" && x.State == "open");
        f.Position = 0; f.Advance(60); await f.Evaluate();
        Assert.Equal("resolved", row.State);
        var resolvedAt = row.ResolvedAtUtc;
        f.Position = 1; f.Advance(60); await f.Evaluate();
        Assert.True(row.PendingFingerprint is not null);
        f.Retired = true; f.Advance(Lifetime + 60);
        Assert.False((await f.Evaluate()).Incomplete);
        Assert.Equal("resolved", row.State);
        Assert.Equal(resolvedAt, row.ResolvedAtUtc);
        Assert.NotNull(row.UnverifiableAtUtc);
        Assert.Equal("unverifiable", Assert.Single(await f.Service.ReadAsync(f.Account.Id, null, default)).Outcome);
        Assert.Single(f.Events.Items, x => x.Type == "discrepancy.unverifiable");
    }

    [Fact] // Finding 3: plain resolved history without pending work is untouched.
    public async Task Plain_resolved_history_is_not_made_unverifiable()
    {
        var f = Untracked();
        await f.Confirm();
        var row = f.Store.Rows.Single(x => x.Kind == "position.excess");
        f.Position = 0; f.Advance(60); await f.Evaluate();
        var revision = row.Revision;
        f.Retired = true; f.Advance(Lifetime + 60); await f.Evaluate();
        Assert.Null(row.UnverifiableAtUtc);
        Assert.Equal(revision, row.Revision);
        Assert.Null(Assert.Single(await f.Service.ReadAsync(f.Account.Id, null, default)).Outcome);
        Assert.DoesNotContain(f.Events.Items, x => x.Type == "discrepancy.unverifiable");
    }

    [Fact] // Finding 4
    public async Task Unverifiable_event_is_emitted_once_per_transition_with_a_revision_key()
    {
        var f = Untracked();
        await f.Evaluate();
        var row = f.Store.Rows.Single(x => x.Kind == "position.excess");
        var lastObserved = row.LastObservedAtUtc;
        f.Retired = true; f.Advance(Lifetime + 60); await f.Evaluate();
        f.Advance(600); await f.Evaluate();
        var unverifiable = Assert.Single(f.Events.Items, x => x.Type == "discrepancy.unverifiable");
        Assert.Equal("warning", unverifiable.Severity);
        Assert.Equal($"discrepancy:{row.Id}:{row.Revision}:unverifiable", unverifiable.DedupKey);
        Assert.Equal("candidate", unverifiable.Data.GetProperty("state").GetString());
        Assert.Equal("unverifiable", unverifiable.Data.GetProperty("outcome").GetString());
        Assert.Equal(lastObserved, unverifiable.Data.GetProperty("lastObservedAtUtc").GetDateTimeOffset());
        Assert.Equal(row.UnverifiableAtUtc, unverifiable.Data.GetProperty("unverifiableAtUtc").GetDateTimeOffset());
        Assert.Contains("discrepancy.unverifiable", VesselEventValues.Types);
        // A fresh decision clears the announced candidate's outcome; its clearance is then published too.
        f.Retired = false; f.Position = 0; f.Advance(60); await f.Evaluate();
        Assert.Equal("resolved", row.State);
        Assert.Equal(["discrepancy.unverifiable", "discrepancy.resolved"], f.Events.Items.Select(x => x.Type).ToArray());
    }

    private static DiscrepancyFixture Untracked()
    {
        var f = new DiscrepancyFixture { Position = 1 };
        f.Store.Plays.Clear(); f.Store.Links.Clear(); f.Store.Orders.Clear(); f.Store.Fills.Clear(); f.VenueOrders.Clear();
        return f;
    }
}

public sealed class MonitorDiscrepancyRound4PostgresTests
{
    [PostgresFact] // Finding 1: continuously failing reads still age pending-only work under the account fence.
    public async Task Failing_reads_expire_pending_only_work_and_release_the_account()
    {
        await using var database = await DiscrepancyDatabase.Create();
        var f = new DiscrepancyFixture { Position = 1 };
        f.Account.Configure(null, "0x" + Guid.NewGuid().ToString("N") + "00000000", null);
        f.Store.Plays.Clear(); f.Store.Links.Clear(); f.Store.Orders.Clear(); f.Store.Fills.Clear(); f.VenueOrders.Clear();
        var plan = new PlayPlanDocument("long", "quantity", "1", "1", null,
            [new("e", "Entry", "#ffffff", "100", "100", [new("s", "price", "90", "100")], [new("t", "price", "120", "100")])], new("", "", "", ""));
        var play = new Play(Guid.NewGuid(), f.Account, new PerpetualInstrument("hyperliquid", "BTC"), InstrumentSource.Venue,
            PlayDocuments.Serialize(plan), f.Clock.Now.AddHours(-1));
        play.MarkPlanned(f.Clock.Now.AddMinutes(-30));
        f.Store.Plays.Add(play);
        f.Store.Links.Add(new(play, "late-entry", OrderLinkRole.Entry, "e", null, OrderLinkState.Linked, OrderLinkSource.Owner, f.Clock.Now.AddMinutes(-25)));
        play.Cancel(CancelReason.ChangedMind, null, f.Clock.Now.AddMinutes(-10));
        await database.Seed(f);
        f.VenueOrders.Add(new("late-entry", "BTC", "buy", "Limit", 100, null, false, false, 1, 0, f.Clock.Now.AddMinutes(-25),
            VenueOrderStatus.Filled, "filled", f.Clock.Now.AddMinutes(-2)));
        await using var scope = database.Scope(f);
        var reader = new SwitchableReader(f);
        var monitor = new MonitorStore(scope.Db, scope.Work);
        var coordinator = new MonitorCoordinator(new MonitorWorkerOnline(monitor, f.Clock), new WorkspaceStore(scope.Db, scope.Work), new NoImporter(),
            TestVenues.With(reader, new FixedOrders(f)), new NoCredentials(), scope.Work, scope.Events, new NoCommands(),
            new CoreOwner(f.Account.OwnerId), new MonitorOptions(), f.Clock, scope.Service);
        var request = await coordinator.RequestAsync(f.Account.Id, default);
        Assert.True(await coordinator.RunAsync((await monitor.ClaimAsync(f.Account.Id, request.RequestId, "worker", f.Clock.Now, default))!, default));
        Assert.Equal("candidate", (await scope.Db.Set<PlayDiscrepancy>().SingleAsync()).State);

        // From now on every venue read fails; only the pending candidate keeps the account eligible.
        reader.Failing = true;
        f.Advance(61);
        Assert.False(await coordinator.RunAsync(Assert.Single(await monitor.ClaimDueAsync("scheduler", f.Clock.Now, 2, default)), default));
        Assert.NotNull((await monitor.FindAsync(f.Account.Id, default))!.NextRunAtUtc);
        Assert.Null((await scope.Db.Set<PlayDiscrepancy>().SingleAsync()).UnverifiableAtUtc);

        f.Advance((int)TimeSpan.FromDays(7).TotalSeconds);
        Assert.False(await coordinator.RunAsync(Assert.Single(await monitor.ClaimDueAsync("scheduler", f.Clock.Now, 2, default)), default));
        var row = await scope.Db.Set<PlayDiscrepancy>().SingleAsync();
        Assert.Equal("candidate", row.State);
        Assert.NotNull(row.UnverifiableAtUtc);
        Assert.Null(row.ResolvedAtUtc);
        var state = (await monitor.FindAsync(f.Account.Id, default))!;
        Assert.Null(state.NextRunAtUtc);
        Assert.False(await monitor.EligibleAsync(f.Account.Id, f.Clock.Now, default));
        var events = (await EventReads.ReadAsync(scope.Db, 0, 100, default)).Events.Where(x => x.Type.StartsWith("discrepancy.")).ToArray();
        var unverifiable = Assert.Single(events);
        Assert.Equal(("discrepancy.unverifiable", "warning", $"discrepancy:{row.Id}:{row.Revision}:unverifiable"),
            (unverifiable.Type, unverifiable.Severity, unverifiable.DedupKey));
        Assert.Equal("unverifiable", Assert.Single(await scope.Service.ReadAsync(f.Account.Id, null, default)).Outcome);
    }

    private sealed class SwitchableReader(DiscrepancyFixture f) : IPerpetualVenueReader
    {
        public bool Failing;
        public string VenueId => "hyperliquid";
        public Task<IReadOnlyList<VenueInstrument>> ReadInstrumentsAsync(CancellationToken ct) => Task.FromResult(f.Observation().Read.Sync.Instruments);
        public Task<PerpetualVenueReadResult> ReadAsync(string source, CancellationToken ct) => Failing
            ? throw new HttpRequestException("synthetic venue outage")
            : Task.FromResult(f.Observation().Read.Sync with { FillHistoryComplete = true });
    }
    private sealed class FixedOrders(DiscrepancyFixture f) : IVenueOrderReader
    {
        public string VenueId => "hyperliquid";
        public Task<VenueOrderReadResult> ReadOrdersAsync(string source, CancellationToken ct) => Task.FromResult(f.Observation().Read.Orders!);
    }
    private sealed class NoImporter : IMonitorImporter
    {
        public Task RetainAsync(Account account, VenueOrderReadResult orders, CancellationToken ct) => Task.CompletedTask;
        public Task ReconcileAsync(Account account, VenueOrderReadResult orders, IReadOnlyList<VenueInstrument> instruments, CancellationToken ct) => Task.CompletedTask;
    }
    private sealed class NoCredentials : IAccountCredentialReader
    {
        public Task<string?> ReadAsync(Guid accountId, CancellationToken ct) => Task.FromResult<string?>(null);
        public Task<CredentialAttempt?> ReadAttemptAsync(Guid accountId, CancellationToken ct) => Task.FromResult<CredentialAttempt?>(null);
        public Task MarkRefusedAsync(Guid accountId, string attemptedRevision, CancellationToken ct) => Task.CompletedTask;
    }
    private sealed class NoCommands : IMonitorCommandSink
    {
        public Task EnqueueAsync(MonitorAccountCommand command, CancellationToken ct) => Task.CompletedTask;
    }
}
