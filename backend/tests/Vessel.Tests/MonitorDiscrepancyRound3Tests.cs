using Microsoft.EntityFrameworkCore;
using Vessel.Application.Credentials;
using Vessel.Application.Events;
using Vessel.Application.Monitoring;
using Vessel.Application.Ownership;
using Vessel.Application.Plays;
using Vessel.Application.Plays.Execution;
using Vessel.Application.Venues;
using Vessel.Domain.Accounts;
using Vessel.Domain.Markets;
using Vessel.Domain.Monitoring;
using Vessel.Domain.Plays;
using Vessel.Domain.Workspace;
using Vessel.Persistence;

namespace Vessel.Tests;

/// <summary>Third review round for PR #46: durable re-confirmation, stop mechanics and bounded unobservable lifetime.</summary>
public sealed class MonitorDiscrepancyRound3Tests
{
    [Fact] // Finding 2 (Sol r2)
    public async Task Take_profit_linked_as_stop_must_not_protect_sibling()
    {
        var f = new DiscrepancyFixture { Position = 2 };
        var sibling = f.AddPlay("long", 1);
        f.Stop(o => o with { OrderType = "Take Profit Market", TriggerPrice = 120, IsPositionTpsl = true, OriginalSize = 0, RemainingSize = 0 });
        await f.Confirm();
        Assert.Contains(f.Store.Rows, x => x.Kind == "protection.missing" && x.PlayId == sibling.Id && x.State == "open");
        Assert.Contains(f.Store.Rows, x => x.Kind == "protection.missing" && x.PlayId == f.Play.Id && x.State == "open");
    }

    [Fact] // Finding 2 (Sol r2)
    public async Task Shared_buy_stop_protects_short_siblings()
    {
        var f = new DiscrepancyFixture { Position = -2 };
        f.Store.Plays.Clear(); f.Store.Links.Clear(); f.Store.Orders.Clear(); f.Store.Fills.Clear(); f.VenueOrders.Clear();
        var first = f.AddPlay("short", 1, "entry");
        f.AddPlay("short", 1);
        f.Store.Links.Add(new(first, "stop", OrderLinkRole.Stop, "e", "s", OrderLinkState.Linked, OrderLinkSource.Owner, f.Clock.Now.AddMinutes(-15)));
        f.VenueOrders.Add(new("stop", "BTC", "buy", "Stop Market", 110, 110, true, true, 0, 0, f.Clock.Now.AddMinutes(-15), VenueOrderStatus.Open, "open", f.Clock.Now));
        await f.Confirm();
        Assert.DoesNotContain(f.Store.Rows, x => x.Kind == "protection.missing");
        f.Advance(60);
        Assert.False((await f.Evaluate()).Incomplete);
    }

    [Fact] // Finding 2: venue-neutral words, e.g. hyphenated adapter types.
    public async Task Hyphenated_take_profit_linked_as_stop_does_not_protect_its_own_play()
    {
        var f = new DiscrepancyFixture();
        f.Stop(o => o with { OrderType = "take-profit", TriggerPrice = 120 });
        await f.Confirm();
        Assert.Contains(f.Store.Rows, x => x.Kind == "protection.missing" && x.State == "open");
    }

    [Fact] // Finding 2: unrecognized mechanics are unknown, never protected and never critical missing.
    public async Task Unrecognized_trigger_mechanics_leave_stop_coverage_unknown()
    {
        var f = new DiscrepancyFixture();
        f.Stop(o => o with { OrderType = "Trigger" });
        Assert.True((await f.Evaluate()).Incomplete);
        f.Advance(60); await f.Evaluate();
        Assert.DoesNotContain(f.Store.Rows, x => x.Kind is "protection.missing" or "protection.short" or "protection.cancelled");
    }

    [Fact] // Finding 2: one classification for matching, link validation and monitoring.
    public void Order_mechanics_are_classified_once_and_refuse_take_profit_stops()
    {
        Assert.Equal(OrderMechanism.Stop, OrderMechanics.Classify("Stop Market", true));
        Assert.Equal(OrderMechanism.Stop, OrderMechanics.Classify("stop-loss-limit", true));
        Assert.Equal(OrderMechanism.TakeProfit, OrderMechanics.Classify("Take Profit Limit", true));
        Assert.Equal(OrderMechanism.TakeProfit, OrderMechanics.Classify("take-profit", true));
        Assert.Equal(OrderMechanism.UnknownTrigger, OrderMechanics.Classify("Trigger", true));
        Assert.Equal(OrderMechanism.Plain, OrderMechanics.Classify("Limit", false));
        var plan = new PlayPlanDocument("long", "quantity", "1", "1", null, [], new("", "", "", ""));
        ImportedOrder Order(string type) => new() { OrderId = "o", ContractId = "BTC", Side = "sell", OrderType = type, TriggerPrice = 120,
            LimitPrice = 120, ReduceOnly = true, OriginalSize = 1, RemainingSize = 1, Status = "open", VenueStatus = "open" };
        Assert.NotNull(ExecutionIntegrity.RoleConflict(OrderLinkRole.Stop, plan, Order("take-profit"), []));
        Assert.NotNull(ExecutionIntegrity.RoleConflict(OrderLinkRole.Stop, plan, Order("Take Profit Market"), []));
        Assert.Null(ExecutionIntegrity.RoleConflict(OrderLinkRole.Stop, plan, Order("Stop Market"), []));
        Assert.Null(ExecutionIntegrity.RoleConflict(OrderLinkRole.Target, plan, Order("take-profit"), []));
    }

    [Fact] // Finding 1: an interrupted re-confirmation stays outstanding work and still confirms later.
    public async Task Interrupted_reconfirmation_stays_outstanding_and_confirms()
    {
        var f = new DiscrepancyFixture { Position = 2 };
        await f.Confirm();
        var row = f.Store.Rows.Single(x => x.Kind == "position.excess");
        f.Position = 1; f.Advance(60); await f.Evaluate();
        Assert.Equal("resolved", row.State);
        f.Position = 2; f.Advance(60); await f.Evaluate();
        Assert.True(row.PendingFingerprint is not null);
        f.PositionsComplete = false; f.Advance(60);
        Assert.True((await f.Evaluate()).Incomplete);
        Assert.Equal("resolved", row.State);
        Assert.True(row.PendingFingerprint is not null);
        f.PositionsComplete = true; f.Advance(60); await f.Confirm();
        Assert.Equal("open", row.State);
        Assert.False(row.PendingFingerprint is not null);
    }

    [Fact] // Finding 3
    public async Task Unobservable_open_record_becomes_visible_unverifiable_after_its_lifetime()
    {
        var f = Untracked();
        await f.Confirm();
        var row = f.Store.Rows.Single(x => x.Kind == "position.excess" && x.State == "open");
        f.Retired = true;
        f.Advance(60); Assert.True((await f.Evaluate()).Incomplete);
        f.Advance((int)TimeSpan.FromDays(7).TotalSeconds);
        Assert.False((await f.Evaluate()).Incomplete);
        Assert.Equal("open", row.State);
        Assert.NotNull(row.UnverifiableAtUtc);
        var dto = Assert.Single(await f.Service.ReadAsync(f.Account.Id, null, default), x => x.Id == row.Id);
        Assert.Equal("unverifiable", dto.Outcome);
        Assert.Null(dto.ResolvedAtUtc);
        Assert.DoesNotContain(f.Events.Items, x => x.Type == "discrepancy.resolved");
        f.Advance(600); Assert.False((await f.Evaluate()).Incomplete);
        // A fresh decision makes it verifiable again.
        f.Retired = false; f.Advance(60); await f.Evaluate();
        Assert.Null(row.UnverifiableAtUtc);
        Assert.Equal("open", row.State);
    }

    [Fact] // Finding 3: an unconfirmed candidate becomes visible and dismissable.
    public async Task Unobservable_candidate_becomes_visible_and_dismissable()
    {
        var f = Untracked();
        await f.Evaluate();
        var row = f.Store.Rows.Single(x => x.Kind == "position.excess" && x.State == "candidate");
        f.Retired = true;
        f.Advance((int)TimeSpan.FromDays(7).TotalSeconds + 60);
        await f.Evaluate();
        var dto = Assert.Single(await f.Service.ReadAsync(f.Account.Id, null, default), x => x.Id == row.Id);
        Assert.Equal("candidate", dto.State);
        Assert.Equal("unverifiable", dto.Outcome);
        await f.Service.DismissAsync(f.Account.Id, null, row.Id, "venue retired the market", default);
        Assert.Equal("dismissed", row.State);
        // Announced as unverifiable, so its dismissal is published like any other.
        Assert.Equal(["discrepancy.unverifiable", "discrepancy.resolved"], f.Events.Items.Select(x => x.Type).ToArray());
    }

    [Fact] // Finding 3: the lifetime is configurable.
    public void Unobservable_lifetime_defaults_to_seven_days_and_is_validated()
    {
        Assert.Equal(TimeSpan.FromDays(7), new MonitorOptions().UnobservableLifetime);
        Assert.Throws<InvalidOperationException>(() => new MonitorOptions { UnobservableLifetime = TimeSpan.FromMinutes(5) }.Validate());
    }

    private static DiscrepancyFixture Untracked()
    {
        var f = new DiscrepancyFixture { Position = 1 };
        f.Store.Plays.Clear(); f.Store.Links.Clear(); f.Store.Orders.Clear(); f.Store.Fills.Clear(); f.VenueOrders.Clear();
        return f;
    }
}

public sealed class MonitorDiscrepancyRound3PostgresTests
{
    [PostgresFact] // Finding 1 (Sol r2)
    public Task Reconfirm_resolved_excess_after_last_watch_ends_keeps_schedule() => Reconfirm(false);

    [PostgresFact] // Finding 1 (Sol r2)
    public Task Reconfirm_changed_dismissed_excess_after_last_watch_ends_keeps_schedule() => Reconfirm(true);

    [PostgresFact] // Findings 1 and 3: outstanding work holds eligibility across interruptions; unverifiable does not.
    public async Task Pending_reconfirmation_holds_eligibility_until_unverifiable()
    {
        await using var database = await DiscrepancyDatabase.Create();
        var f = new DiscrepancyFixture();
        f.Store.Plays.Clear(); f.Store.Links.Clear(); f.Store.Orders.Clear(); f.Store.Fills.Clear();
        await database.Seed(f);
        var row = new PlayDiscrepancy { OwnerId = f.Account.OwnerId, AccountId = f.Account.Id, Kind = "position.excess", SubjectKey = "x",
            ContractId = "BTC", NativeContractId = "BTC", Severity = "warning", State = "resolved", PendingFingerprint = "AB",
            PendingSinceUtc = null, LastObservedAtUtc = f.Clock.Now };
        await using (var seed = database.Scope(f)) { seed.Db.Add(row); await seed.Db.SaveChangesAsync(); }
        await using (var scope = database.Scope(f))
            Assert.True(await new MonitorStore(scope.Db, scope.Work).EligibleAsync(f.Account.Id, f.Clock.Now, default));
        await using (var scope = database.Scope(f))
        {
            (await scope.Db.Set<PlayDiscrepancy>().SingleAsync()).UnverifiableAtUtc = f.Clock.Now;
            (await scope.Db.Set<PlayDiscrepancy>().SingleAsync()).State = "open";
            await scope.Db.SaveChangesAsync();
        }
        await using (var scope = database.Scope(f))
            Assert.False(await new MonitorStore(scope.Db, scope.Work).EligibleAsync(f.Account.Id, f.Clock.Now, default));
    }

    [PostgresFact] // Finding 3: the outcome is persisted.
    public async Task Unverifiable_outcome_persists()
    {
        await using var database = await DiscrepancyDatabase.Create();
        var f = new DiscrepancyFixture { Position = 1 };
        f.Store.Plays.Clear(); f.Store.Links.Clear(); f.Store.Orders.Clear(); f.Store.Fills.Clear(); f.VenueOrders.Clear();
        await database.Seed(f);
        async Task Run() { await using var scope = database.Scope(f); await scope.Evaluate(f.Observation()); }
        await Run(); f.Advance(60); await Run();
        f.Retired = true; f.Advance((int)TimeSpan.FromDays(7).TotalSeconds + 60); await Run();
        await using var read = database.Scope(f);
        var dto = Assert.Single(await read.Service.ReadAsync(f.Account.Id, null, default));
        Assert.Equal(("open", "unverifiable"), (dto.State, dto.Outcome));
    }

    private static async Task Reconfirm(bool dismissed)
    {
        await using var database = await DiscrepancyDatabase.Create();
        // A real previous position discrepancy from an earlier active Play on this account/contract.
        var f = new DiscrepancyFixture { Position = 2 };
        await f.Confirm();
        var historical = f.Store.Rows.Single(x => x.Kind == "position.excess");
        if (dismissed) await f.Service.DismissAsync(f.Account.Id, null, historical.Id, null, default);
        else { f.Position = 1; f.Advance(61); await f.Evaluate(); }
        f.Position = 1;
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
        f.VenueOrders.Add(new("late-entry", "BTC", "buy", "Limit", 100, null, false, false, 1, 0, f.Clock.Now.AddMinutes(-25),
            VenueOrderStatus.Filled, "filled", f.Clock.Now.AddMinutes(-2)));
        await database.Seed(f);
        await using (var history = database.Scope(f))
        {
            history.Db.Add(historical);
            await history.Db.SaveChangesAsync();
        }
        f.Advance(61);
        await using var scope = database.Scope(f);
        var monitor = new MonitorStore(scope.Db, scope.Work);
        var coordinator = new MonitorCoordinator(monitor, new WorkspaceStore(scope.Db, scope.Work), new NoImporter(),
            TestVenues.With(new FixedReader(f), new FixedOrders(f)), new NoCredentials(), scope.Work, scope.Events, new NoCommands(),
            new CoreOwner(f.Account.OwnerId), new MonitorOptions(), f.Clock, scope.Service);
        var request = await coordinator.RequestAsync(f.Account.Id, default);
        var lease = (await monitor.ClaimAsync(f.Account.Id, request.RequestId, "worker", f.Clock.Now, default))!;
        Assert.True(await coordinator.RunAsync(lease, default));
        var row = await scope.Db.Set<PlayDiscrepancy>().SingleAsync(x => x.Kind == "position.excess");
        Assert.NotNull(row.PendingFingerprint);
        Assert.Equal(dismissed ? "dismissed" : "resolved", row.State);
        Assert.NotNull(await scope.Db.Set<MonitorExitWatch>().SingleAsync(x => x.EndedAtUtc != null));
        Assert.NotNull((await monitor.FindAsync(f.Account.Id, default))!.NextRunAtUtc);
        // The re-confirmation run reopens it.
        f.Advance(61);
        var confirmation = Assert.Single(await monitor.ClaimDueAsync("scheduler", f.Clock.Now, 2, default));
        Assert.True(await coordinator.RunAsync(confirmation, default));
        Assert.Equal("open", (await scope.Db.Set<PlayDiscrepancy>().SingleAsync(x => x.Kind == "position.excess")).State);
    }

    private sealed class FixedReader(DiscrepancyFixture f) : IPerpetualVenueReader
    {
        public string VenueId => "hyperliquid";
        public Task<IReadOnlyList<VenueInstrument>> ReadInstrumentsAsync(CancellationToken ct) => Task.FromResult(f.Observation().Read.Sync.Instruments);
        public Task<PerpetualVenueReadResult> ReadAsync(string source, CancellationToken ct) => Task.FromResult(f.Observation().Read.Sync with { FillHistoryComplete = true });
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
