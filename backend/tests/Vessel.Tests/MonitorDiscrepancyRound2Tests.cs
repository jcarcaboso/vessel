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
using Vessel.Domain.Workspace;
using Vessel.Persistence;

namespace Vessel.Tests;

/// <summary>Second review round for PR #46: eligibility, drift identity and shared stop coverage.</summary>
public sealed class MonitorDiscrepancyRound2Tests
{
    [Fact] // Finding 2
    public async Task Partial_close_rearms_a_dismissed_level_drift()
    {
        var f = new DiscrepancyFixture();
        f.Stop(o => o with { TriggerPrice = 80m });
        await f.Confirm();
        var row = f.Store.Rows.Single(x => x.Kind == "level.drift" && x.State == "open");
        await f.Service.DismissAsync(f.Account.Id, f.Play.Id, row.Id, null, default);
        f.Advance(60); await f.Confirm();
        Assert.Equal("dismissed", row.State);
        // A target fills half the position; the stop keeps its drifted price.
        f.AddOrder("target", OrderLinkRole.Target, .5m, 120);
        var index = f.VenueOrders.FindIndex(x => x.OrderId == "target");
        f.VenueOrders[index] = f.VenueOrders[index] with { Status = VenueOrderStatus.Filled, VenueStatus = "filled", RemainingSize = 0 };
        f.Fill("tp-fill", "target", .5m, f.Clock.Now.AddMinutes(-1), "sell", ExecutionFacts.Close);
        f.Position = .5m;
        f.Advance(60); await f.Confirm();
        Assert.Equal("open", row.State);
        Assert.Equal(2, f.Events.Items.Count(x => x.Type == "discrepancy.opened" && x.Subject.DiscrepancyId == row.Id));
    }

    [Fact] // Finding 2: open records still follow quantity changes silently.
    public async Task Open_level_drift_follows_a_partial_close_without_another_opened_event()
    {
        var f = new DiscrepancyFixture();
        f.Stop(o => o with { TriggerPrice = 80m });
        await f.Confirm();
        var row = f.Store.Rows.Single(x => x.Kind == "level.drift" && x.State == "open");
        var fingerprint = row.Fingerprint;
        f.Stop(o => o with { RemainingSize = .5m });
        f.Advance(60); await f.Confirm();
        Assert.Equal("open", row.State);
        Assert.NotEqual(fingerprint, row.Fingerprint);
        Assert.Single(f.Events.Items, x => x.Type == "discrepancy.opened" && x.Subject.DiscrepancyId == row.Id);
    }

    [Fact] // Finding 3: one precomputed lookup per instrument, still correct with many siblings.
    public async Task Many_sibling_plays_share_one_whole_position_stop()
    {
        var f = new DiscrepancyFixture { Position = 61 };
        var siblings = Enumerable.Range(0, 60).Select(_ => f.AddPlay("long", 1)).ToArray();
        f.Stop(o => o with { IsPositionTpsl = true, OriginalSize = 0, RemainingSize = 0 });
        await f.Evaluate(); f.Advance(60);
        Assert.False((await f.Evaluate()).Incomplete);
        Assert.DoesNotContain(f.Store.Rows, x => x.Kind == "protection.missing");
        Assert.Equal(60, siblings.Length);
    }

    [Fact] // Finding 4: a whole-position target never establishes stop protection.
    public async Task Whole_position_target_never_protects_a_sibling()
    {
        var f = new DiscrepancyFixture { Position = 2 };
        var sibling = f.AddPlay("long", 1);
        f.VenueOrders.Clear();
        f.AddOrder("target", OrderLinkRole.Target, 0, 120);
        var index = f.VenueOrders.FindIndex(x => x.OrderId == "target");
        f.VenueOrders[index] = f.VenueOrders[index] with { IsPositionTpsl = true };
        await f.Confirm();
        Assert.Contains(f.Store.Rows, x => x.PlayId == sibling.Id && x.Kind == "protection.missing" && x.State == "open" && x.Severity == "critical");
        Assert.Contains(f.Store.Rows, x => x.PlayId == f.Play.Id && x.Kind == "protection.missing" && x.State == "open");
    }

    [Fact] // Finding 4: a buy stop does not protect long exposure.
    public async Task Wrong_side_whole_position_stop_protects_nothing()
    {
        var f = new DiscrepancyFixture { Position = 2 };
        var sibling = f.AddPlay("long", 1);
        f.Stop(o => o with { Side = "buy", IsPositionTpsl = true, OriginalSize = 0, RemainingSize = 0 });
        await f.Confirm();
        Assert.Contains(f.Store.Rows, x => x.PlayId == sibling.Id && x.Kind == "protection.missing" && x.State == "open");
        Assert.Contains(f.Store.Rows, x => x.PlayId == f.Play.Id && x.Kind == "protection.missing" && x.State == "open");
    }

    [Fact] // Finding 4: net-position equality never allocates per-Play protection across opposing Plays.
    public async Task Opposing_plays_that_net_out_do_not_share_whole_position_coverage()
    {
        var f = new DiscrepancyFixture { Position = 1 }; // long 1 + long 1 + short 1
        var sameSide = f.AddPlay("long", 1);
        var opposite = f.AddPlay("short", 1);
        f.Stop(o => o with { RemainingSize = 1 }); // Only the first Play's own stop at first.
        await f.Confirm();
        var unprotected = f.Store.Rows.Single(x => x.PlayId == sameSide.Id && x.Kind == "protection.missing" && x.State == "open");
        var shortMissing = f.Store.Rows.Single(x => x.PlayId == opposite.Id && x.Kind == "protection.missing" && x.State == "open");
        f.Stop(o => o with { IsPositionTpsl = true, OriginalSize = 0, RemainingSize = 0 });
        f.Advance(60); await f.Confirm();
        Assert.Equal("open", unprotected.State); // Unknown, so not cleared by the net match.
        Assert.Equal("open", shortMissing.State); // A sell stop never covers the short.
        Assert.DoesNotContain(f.Events.Items, x => x.Type == "discrepancy.resolved" && x.Subject.DiscrepancyId == unprotected.Id);
    }

    [Fact] // Event contract: transitions bump the revision and stay distinct; silent updates do not.
    public async Task Open_resolve_reopen_dismiss_emits_opened_resolved_opened_resolved_with_revisioned_keys()
    {
        var f = new DiscrepancyFixture { Position = 0 };
        await f.Confirm();
        var row = f.Store.Rows.Single(x => x.Kind == "position.missing");
        f.Position = 1; f.Advance(60); await f.Evaluate();
        Assert.Equal("resolved", row.State);
        f.Position = 0; f.Advance(60); await f.Confirm();
        Assert.Equal("open", row.State);
        await f.Service.DismissAsync(f.Account.Id, null, row.Id, null, default);
        var events = f.Events.Items.Where(x => x.Subject.DiscrepancyId == row.Id).ToArray();
        Assert.Equal(["discrepancy.opened", "discrepancy.resolved", "discrepancy.opened", "discrepancy.resolved"], events.Select(x => x.Type).ToArray());
        Assert.Equal([$"discrepancy:{row.Id}:1:opened", $"discrepancy:{row.Id}:2:resolved", $"discrepancy:{row.Id}:3:opened",
            $"discrepancy:{row.Id}:4:dismissed"], events.Select(x => x.DedupKey).ToArray());
    }
}

public sealed class MonitorDiscrepancyRound2PostgresTests
{
    [PostgresFact] // Finding 1
    public async Task Cancelled_plays_entry_filling_after_cancellation_still_gets_its_confirmation_run()
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
        // The entry filled after cancellation: its watch resolves, but the venue now holds untracked exposure.
        f.VenueOrders.Add(new("late-entry", "BTC", "buy", "Limit", 100, null, false, false, 1, 0, f.Clock.Now.AddMinutes(-25),
            VenueOrderStatus.Filled, "filled", f.Clock.Now.AddMinutes(-2)));
        await using var scope = database.Scope(f);
        var monitor = new MonitorStore(scope.Db, scope.Work);
        var coordinator = new MonitorCoordinator(new MonitorWorkerOnline(monitor, f.Clock), new WorkspaceStore(scope.Db, scope.Work), new NoImporter(),
            TestVenues.With(new FixedReader(f), new FixedOrders(f)), new NoCredentials(), scope.Work, scope.Events, new NoCommands(),
            new CoreOwner(f.Account.OwnerId), new MonitorOptions(), f.Clock, scope.Service);
        var request = await coordinator.RequestAsync(f.Account.Id, default);
        var lease = (await monitor.ClaimAsync(f.Account.Id, request.RequestId, "worker", f.Clock.Now, default))!;
        Assert.True(await coordinator.RunAsync(lease, default));
        Assert.NotNull(await scope.Db.Set<MonitorExitWatch>().SingleAsync(x => x.EndedAtUtc != null));
        Assert.Equal("candidate", (await scope.Db.Set<PlayDiscrepancy>().SingleAsync(x => x.Kind == "position.excess")).State);
        Assert.NotNull((await monitor.FindAsync(f.Account.Id, default))!.NextRunAtUtc);

        f.Advance(61);
        var confirmation = Assert.Single(await monitor.ClaimDueAsync("scheduler", f.Clock.Now, 2, default));
        Assert.True(await coordinator.RunAsync(confirmation, default));
        var opened = (await EventReads.ReadAsync(scope.Db, 0, 100, default)).Events.Where(x => x.Type == "discrepancy.opened").ToArray();
        Assert.Equal("position.excess", Assert.Single(opened).Data.GetProperty("kind").GetString());

        // The open warning keeps Check available until fresh evidence clears it.
        f.Advance(61);
        await coordinator.RequestAsync(f.Account.Id, default);
    }

    [PostgresFact] // Event contract after pruning: dedup keys are retained and never reused.
    public async Task Revisioned_dedup_keys_survive_event_pruning()
    {
        await using var database = await DiscrepancyDatabase.Create();
        var f = new DiscrepancyFixture { Position = 0 };
        await database.Seed(f);
        var types = new List<string>();
        async Task Collect()
        {
            await using var read = database.Scope(f);
            types.AddRange((await EventReads.ReadAsync(read.Db, 0, 100, default)).Events
                .Where(x => x.Type.StartsWith("discrepancy.")).Select(x => x.Type));
            // Prune delivered history, as retention does; dedup keys stay.
            await read.Db.Database.ExecuteSqlRawAsync("DELETE FROM events");
        }
        async Task Run() { await using var scope = database.Scope(f); await scope.Evaluate(f.Observation()); }
        await Run(); f.Advance(60); await Run(); await Collect();
        f.Position = 1; f.Advance(60); await Run(); await Collect();
        f.Position = 0; f.Advance(60); await Run(); f.Advance(60); await Run(); await Collect();
        await using (var dismiss = database.Scope(f))
        {
            var id = (await dismiss.Db.Set<PlayDiscrepancy>().SingleAsync(x => x.Kind == "position.missing")).Id;
            await dismiss.Service.DismissAsync(f.Account.Id, null, id, null, default);
        }
        await Collect();
        Assert.Equal(["discrepancy.opened", "discrepancy.resolved", "discrepancy.opened", "discrepancy.resolved"], types);
        await using var check = database.Scope(f);
        var row = await check.Db.Set<PlayDiscrepancy>().SingleAsync(x => x.Kind == "position.missing");
        var keys = await check.Db.Database.SqlQueryRaw<string>("SELECT dedup_key AS \"Value\" FROM event_dedup WHERE dedup_key LIKE 'discrepancy:%'").ToListAsync();
        Assert.Equal(new[] { $"discrepancy:{row.Id}:1:opened", $"discrepancy:{row.Id}:2:resolved", $"discrepancy:{row.Id}:3:opened",
            $"discrepancy:{row.Id}:4:dismissed" }.Order(), keys.Order());
    }

    private sealed class FixedReader(DiscrepancyFixture f) : IPerpetualVenueReader
    {
        public string VenueId => "hyperliquid";
        public Task<IReadOnlyList<VenueInstrument>> ReadInstrumentsAsync(CancellationToken ct) => Task.FromResult(f.Observation().Read.Sync.Instruments);
        public Task<PerpetualVenueReadResult> ReadAsync(string source, CancellationToken ct) =>
            Task.FromResult(f.Observation().Read.Sync with { FillHistoryComplete = true });
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
