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

}
