using Vessel.Application.Plays;
using Vessel.Application.Plays.Execution;
using Vessel.Application.Review;
using Vessel.Application.Sizing;
using Vessel.Application.Workspace;
using Vessel.Domain.Accounts;
using Vessel.Domain.Markets;
using Vessel.Domain.Plays;
using Vessel.Domain.Workspace;
using Vessel.Persistence;

namespace Vessel.Tests;

public sealed class ExecutionQuantityPrecisionTests
{
    private const decimal Huge = 10000000000000000000000000000m;
    private const string HugeText = "10000000000000000000000000000";
    private static readonly DateTimeOffset At = ReviewClock.Now.AddHours(-1);

    [Theory]
    [InlineData("long")]
    [InlineData("short")]
    public async Task Linking_huge_entries_keeps_the_small_residual_open_and_reports_exact_quantities(string direction)
    {
        var f = new Fixture(direction);
        f.Add(OrderLinkRole.Entry, Huge, 0);
        f.Add(OrderLinkRole.Entry, 0.1m, 1, price: 1);
        f.Add(OrderLinkRole.Exit, Huge, 2, pnl: 0.1m);

        var result = await f.LinkAll();

        Assert.Equal(("open", HugeText + ".1", HugeText, "0.1"),
            (result.Status, result.Totals.EnteredQuantity, result.Totals.ExitedQuantity, result.Totals.OpenQuantity));
        Assert.Empty(result.Issues);
        Assert.Equal(HugeText + ".1", Assert.Single(result.Entries).FilledQuantity);
        Assert.Equal(new[] { HugeText, "0.1", HugeText }, result.Links.Select(l => l.FilledQuantity));
        Assert.Equal(PlayStatus.Open, f.Play.Status);
        Assert.DoesNotContain(f.Plays.Changes, c => c.To == PlayStatus.Closed);
        Assert.False(ExecutionIntegrity.Settled(f.Facts));
        Assert.Equal(new[] { Huge, 0.1m, Huge }, f.Store.Fills.Select(fill => fill.Quantity));
    }

    [Theory]
    [InlineData(false, "20000000000000000000000000000.1")]
    [InlineData(true, "100000000000000000000000000000.1")]
    public async Task Execution_dtos_preserve_small_reported_pnl_and_fees_between_large_values(bool aboveDecimalRange, string feeTotal)
    {
        var f = new Fixture();
        var large = aboveDecimalRange ? Huge * 5 : Huge;
        f.Add(OrderLinkRole.Entry, 3, 0, price: 1);
        f.Add(OrderLinkRole.Exit, 1, 1, price: 1, pnl: 0.1m).Fee = 0.1m;
        f.Add(OrderLinkRole.Exit, 1, 2, price: 1, pnl: large).Fee = large;
        f.Add(OrderLinkRole.Exit, 1, 3, price: 1, pnl: -large).Fee = large;

        var result = await f.LinkAll();

        Assert.Equal("closed", result.Status);
        Assert.Equal("0.1", result.Totals.ClosedPnlUsd);
        Assert.Equal(feeTotal, Assert.Single(result.Totals.Fees).Amount);
        Assert.Equal("USDC", Assert.Single(result.Totals.Fees).Token);
        Assert.Equal(ExecutionFacts.PnlGross, result.Totals.ClosedPnlBasis);
        Assert.Equal(new[] { 0m, 0.1m, large, -large }, f.Store.Fills.Select(fill => fill.ClosedPnlUsd));
        Assert.Equal(new[] { 0m, 0.1m, large, large }, f.Store.Fills.Select(fill => fill.Fee));
    }

    [Theory]
    [InlineData("long")]
    [InlineData("short")]
    public async Task A_small_over_exit_is_not_rounded_into_a_closed_play(string direction)
    {
        var f = new Fixture(direction);
        f.Add(OrderLinkRole.Entry, Huge, 0);
        // Link the small exit first so the large exit cannot close the Play before both are associated.
        f.Add(OrderLinkRole.Exit, 0.1m, 2);
        f.Add(OrderLinkRole.Exit, Huge, 1);

        var result = await f.LinkAll();

        Assert.Equal(("open", HugeText, HugeText + ".1", "0"),
            (result.Status, result.Totals.EnteredQuantity, result.Totals.ExitedQuantity, result.Totals.OpenQuantity));
        Assert.Contains("exceed the entered quantity", Assert.Single(result.Issues));
        Assert.False(ExecutionIntegrity.Settled(f.Facts));
    }

    [Theory]
    [InlineData("long")]
    [InlineData("short")]
    public async Task Exact_balance_still_rejects_a_small_exit_before_its_entry(string direction)
    {
        var f = new Fixture(direction);
        f.Add(OrderLinkRole.Entry, Huge, 0);
        f.Add(OrderLinkRole.Entry, 0.1m, 3);
        f.Add(OrderLinkRole.Exit, 0.1m, 1);
        f.Add(OrderLinkRole.Exit, Huge, 2);

        var result = await f.LinkAll();

        Assert.Equal(("open", HugeText + ".1", HugeText + ".1", "0"),
            (result.Status, result.Totals.EnteredQuantity, result.Totals.ExitedQuantity, result.Totals.OpenQuantity));
        Assert.Equal("A linked exit filled before the entry it would close.", Assert.Single(result.Issues));
        Assert.False(ExecutionIntegrity.Chronological(f.Fills));
        Assert.False(ExecutionIntegrity.Settled(f.Facts));
    }

    [Theory]
    [InlineData("long", false)]
    [InlineData("short", false)]
    [InlineData("long", true)]
    [InlineData("short", true)]
    public async Task Balanced_quantities_above_decimal_range_close_and_same_time_fills_net_together(string direction, bool sameTime)
    {
        var f = new Fixture(direction);
        f.Add(OrderLinkRole.Entry, Huge * 5, 0);
        f.Add(OrderLinkRole.Entry, Huge * 5, sameTime ? 0 : 1);
        f.Add(OrderLinkRole.Entry, 0.1m, sameTime ? 0 : 2, price: 1);
        f.Add(OrderLinkRole.Exit, Huge * 5, sameTime ? 0 : 3);
        f.Add(OrderLinkRole.Exit, Huge * 5, sameTime ? 0 : 4);
        f.Add(OrderLinkRole.Exit, 0.1m, sameTime ? 0 : 5, price: 1, pnl: 0.1m);

        var result = await f.LinkAll();
        const string total = "100000000000000000000000000000.1";

        Assert.Equal(("closed", total, total, "0"),
            (result.Status, result.Totals.EnteredQuantity, result.Totals.ExitedQuantity, result.Totals.OpenQuantity));
        Assert.Empty(result.Issues);
        Assert.Equal(total, Assert.Single(result.Entries).FilledQuantity);
        Assert.Equal("0.00000001", Assert.Single(result.Entries).AverageFillPrice);
        Assert.Contains(total, Assert.Single(f.Plays.Changes, c => c.To == PlayStatus.Closed).Note);
        Assert.True(ExecutionIntegrity.Settled(f.Facts));
        if (sameTime) Assert.True(ExecutionIntegrity.Chronological(f.Fills.AsEnumerable().Reverse()));
    }

    [Theory]
    [InlineData("long")]
    [InlineData("short")]
    public async Task Per_order_retained_quantities_do_not_round_up_and_hide_missing_executions(string direction)
    {
        var f = new Fixture(direction);
        f.Add(OrderLinkRole.Entry, Huge - 1, 0, orderId: "in");
        f.Add(OrderLinkRole.Entry, 0.9m, 1, orderId: "in");
        f.Add(OrderLinkRole.Exit, Huge - 1, 2, orderId: "out");
        f.Add(OrderLinkRole.Exit, 0.9m, 3, orderId: "out");
        foreach (var order in f.Store.Orders) order.OriginalSize = Huge;

        var result = await f.LinkAll();
        const string retained = "9999999999999999999999999999.9";

        Assert.Equal(("open", retained, retained, "0"),
            (result.Status, result.Totals.EnteredQuantity, result.Totals.ExitedQuantity, result.Totals.OpenQuantity));
        Assert.Equal(2, result.Issues.Count);
        Assert.All(result.Issues, issue => Assert.Contains("not all of its executions are retained", issue));
        Assert.All(result.Links, link => Assert.Equal(retained, link.FilledQuantity));
        Assert.All(f.Store.Orders, order =>
            Assert.True(ExecutionIntegrity.MissingExecutions(order, f.Store.Fills.Where(fill => fill.ExternalOrderId == order.ExternalOrderId))));
        Assert.False(ExecutionIntegrity.Settled(f.Facts with { IncompleteOrders = ["in", "out"] }));
    }

    [Theory]
    [InlineData("filled", false, true)]
    [InlineData("filled", true, false)]
    [InlineData("open", false, false)]
    [InlineData("canceled", false, false)]
    [InlineData("rejected", false, false)]
    public void Missing_executions_keeps_existing_decimal_callers_and_order_status_rules(string status, bool positionTpsl, bool missing)
    {
        var order = new ImportedOrder { Status = status, IsPositionTpsl = positionTpsl, OriginalSize = 2 };
        Assert.Equal(missing, ExecutionIntegrity.MissingExecutions(order, 1m));
        Assert.Equal(missing, ExecutionIntegrity.MissingExecutions(order, [new ImportedFill { Quantity = 1 }]));
        Assert.False(ExecutionIntegrity.MissingExecutions(order, 2m));
        Assert.False(ExecutionIntegrity.MissingExecutions(order, [new ImportedFill { Quantity = 1 }, new ImportedFill { Quantity = 1 }]));
    }

    [Theory]
    [InlineData("long", "residual")]
    [InlineData("short", "residual")]
    [InlineData("long", "over-exit")]
    [InlineData("short", "over-exit")]
    [InlineData("long", "early-exit")]
    [InlineData("short", "early-exit")]
    public async Task Legacy_false_closed_plays_with_inexact_quantity_history_are_excluded_from_review_and_sizing(string direction, string history)
    {
        var f = new Fixture(direction);
        f.Add(OrderLinkRole.Entry, Huge, 0);
        if (history != "over-exit") f.Add(OrderLinkRole.Entry, 0.1m, history == "early-exit" ? 3 : 1, price: 1);
        if (history != "residual") f.Add(OrderLinkRole.Exit, 0.1m, 1, price: 1);
        f.Add(OrderLinkRole.Exit, Huge, 2, pnl: 0.1m);
        f.Play.MarkOpen("Legacy entry", At);
        f.Play.MarkClosed("Legacy rounded equality", At.AddMinutes(4));
        // The financial result is supported. Quantity integrity, not an unrelated outcome overflow, must exclude it.
        Assert.NotNull(PlayOutcomeCalculator.Outcome(f.Facts));
        Assert.False(ExecutionIntegrity.Settled(f.Facts));
        var review = new ReviewFixture();
        review.Accounts.Add(f.Account);
        review.Closed.Add(f.Facts);
        var sizing = new MemorySizingStore();
        sizing.Closed.Add(f.Facts);

        var report = await review.Service.GetAsync(new("all"), default);
        var record = await new SizingService(sizing, new CoreOwner(f.Account.OwnerId), new ReviewClock(), TestUnitOfWork.None).GetAsync(default);

        Assert.Equal(0, report.Metrics.Count);
        Assert.Equal(1, report.Coverage.IncompleteExecutions);
        Assert.Empty(report.Plays);
        Assert.Equal(0, record.Record.ClosedPlays);
        Assert.Empty(record.Record.Recent);
    }

    [PostgresFact]
    public async Task Persisted_missing_executions_remain_visible_to_real_sizing_and_review_stores()
    {
        await using var database = await CoreDatabase.CreateAsync();
        foreach (var direction in new[] { "long", "short" })
        {
            var f = new Fixture(direction);
            f.Add(OrderLinkRole.Entry, Huge - 1, 0, orderId: "in");
            f.Add(OrderLinkRole.Entry, 0.9m, 1, price: 1, orderId: "in");
            f.Add(OrderLinkRole.Exit, Huge - 1, 2, orderId: "out");
            f.Add(OrderLinkRole.Exit, 0.9m, 3, price: 1, pnl: 0.1m, orderId: "out");
            foreach (var order in f.Store.Orders) order.OriginalSize = Huge;
            await using var db = database.Context(f.Account.OwnerId);
            await SaveLegacyAsync(db, f);
            Assert.NotNull(PlayOutcomeCalculator.Outcome(f.Facts));

            var store = new SizingStore(db, TestUnitOfWork.For(db));
            var facts = Assert.Single(await store.ClosedPlaysAsync(default));
            Assert.Equal(new[] { "in", "out" }, facts.IncompleteOrders!.Order(StringComparer.Ordinal));
            Assert.False(ExecutionIntegrity.Settled(facts));
            Assert.Equal(f.Store.Fills.Select(fill => (fill.Quantity, fill.Price, fill.Fee, fill.ClosedPnlUsd)),
                facts.Fills.OrderBy(fill => fill.Fill.OccurredAtUtc).Select(fill =>
                    (fill.Fill.Quantity, fill.Fill.Price, fill.Fill.Fee, fill.Fill.ClosedPnlUsd)));
            var reviewStore = new ReviewStore(db, store);
            var coverage = await reviewStore.ReadAsync(new("all"), ReviewClock.Now, default);
            Assert.Contains(f.Play.Id, coverage.IncompleteOrderPlayIds!);
            var review = new ReviewService(reviewStore, new ReviewClock());
            var report = await review.GetAsync(new("all"), default);
            var record = await new SizingService(store, new CoreOwner(f.Account.OwnerId), new ReviewClock(), TestUnitOfWork.For(db)).GetAsync(default);
            var exclusions = await review.ExclusionsAsync(new("all"), default);

            Assert.Equal((0, 1), (report.Metrics.Count, report.Coverage.IncompleteExecutions));
            Assert.Empty(report.Plays);
            Assert.Equal(0, record.Record.ClosedPlays);
            Assert.Empty(record.Record.Recent);
            Assert.Equal(new[]
            {
                "Order in is filled at the venue, but not all of its executions are retained yet.",
                "Order out is filled at the venue, but not all of its executions are retained yet.",
            }, Assert.Single(exclusions.Items).Reasons);
        }
    }

    [PostgresFact]
    public async Task Persisted_quantity_exclusions_report_the_residual_even_above_decimal_range()
    {
        await using var database = await CoreDatabase.CreateAsync();
        foreach (var direction in new[] { "long", "short" })
        foreach (var aboveDecimalRange in new[] { false, true })
        {
            var f = new Fixture(direction);
            var large = aboveDecimalRange ? Huge * 5 : Huge;
            f.Add(OrderLinkRole.Entry, large, 0);
            if (aboveDecimalRange) f.Add(OrderLinkRole.Entry, large, 1);
            f.Add(OrderLinkRole.Entry, 0.1m, 2, price: 1);
            f.Add(OrderLinkRole.Exit, large, 3, pnl: 0.1m);
            if (aboveDecimalRange) f.Add(OrderLinkRole.Exit, large, 4);
            await using var db = database.Context(f.Account.OwnerId);
            await SaveLegacyAsync(db, f);
            Assert.NotNull(PlayOutcomeCalculator.Outcome(f.Facts));

            var store = new SizingStore(db, TestUnitOfWork.For(db));
            var facts = Assert.Single(await store.ClosedPlaysAsync(default));
            Assert.Empty(facts.IncompleteOrders!);
            Assert.False(ExecutionIntegrity.Settled(facts));
            var review = new ReviewService(new ReviewStore(db, store), new ReviewClock());
            var report = await review.GetAsync(new("all"), default);
            var exclusions = await review.ExclusionsAsync(new("all"), default);
            var record = await new SizingService(store, new CoreOwner(f.Account.OwnerId), new ReviewClock(), TestUnitOfWork.For(db)).GetAsync(default);

            Assert.Equal((0, 1), (report.Metrics.Count, report.Coverage.IncompleteExecutions));
            Assert.Equal(0, record.Record.ClosedPlays);
            var exclusion = Assert.Single(exclusions.Items);
            Assert.Equal(f.Play.Id, exclusion.PlayId);
            Assert.Equal("Retained entry and exit quantities do not form a closed round trip.", Assert.Single(exclusion.Reasons));
        }
    }

    private static async Task SaveLegacyAsync(VesselDbContext db, Fixture f)
    {
        f.Play.MarkOpen("Legacy entry", At);
        f.Play.MarkClosed("Legacy rounded quantities", At.AddMinutes(10));
        db.Accounts.Add(f.Account);
        db.Plays.Add(f.Play);
        db.PlanRevisions.AddRange(f.Plays.Revisions);
        db.Orders.AddRange(f.Store.Orders);
        db.Fills.AddRange(f.Store.Fills);
        db.OrderLinks.AddRange(f.Fills.DistinctBy(fill => fill.Fill.ExternalOrderId).Select(fill => new PlayOrderLink(
            f.Play, f.Store.Orders.Single(o => o.ExternalOrderId == fill.Fill.ExternalOrderId), fill.Role, fill.Role == OrderLinkRole.Entry ? "entry-1" : null, null,
            OrderLinkState.Linked, OrderLinkSource.Owner, At)));
        await db.SaveChangesAsync();
    }

    private sealed class Fixture
    {
        public Account Account { get; }
        public MemoryPlayStore Plays { get; }
        public MemoryExecutionStore Store { get; }
        public Play Play { get; }
        public List<LinkedFill> Fills { get; } = [];
        public ClosedPlayFacts Facts => new(Play, Plays.Revisions, Fills);
        public PlayExecutionService Service => new(Plays, Store, TestVenues.With(), new ReviewClock(), TestUnitOfWork.None);

        public Fixture(string direction = "long")
        {
            Account = new(Guid.NewGuid(), Guid.NewGuid(), "hyperliquid", "Precision");
            Plays = new(Account.OwnerId);
            Plays.Accounts.Add(Account);
            Play = new(Guid.NewGuid(), Account, new PerpetualInstrument("hyperliquid", "BTC"), InstrumentSource.Venue,
                PlayDocuments.Serialize(TestPlays.Plan("1", direction == "long" ? "0.95" : "1.05") with { Direction = direction }),
                At.AddMinutes(-1));
            Plays.Add(Play);
            Plays.Add(Play.MarkPlanned(At.AddMinutes(-1)).Revision);
            Store = new(Plays);
        }

        public ImportedFill Add(OrderLinkRole role, decimal quantity, int minute, decimal price = 0.00000001m, decimal pnl = 0,
            string? orderId = null)
        {
            orderId ??= "order-" + Fills.Count;
            var entry = role == OrderLinkRole.Entry;
            var side = ExecutionIntegrity.EntrySide(PlayDocuments.Read(Play.Plan));
            if (!entry) side = side == ExecutionFacts.Buy ? ExecutionFacts.Sell : ExecutionFacts.Buy;
            var fill = new ImportedFill
            {
                Id = Guid.NewGuid(), OwnerId = Account.OwnerId, AccountId = Account.Id, ContractId = "BTC",
                SourceFillId = "fill-" + Fills.Count, ExternalOrderId = orderId, Side = side, Direction = "",
                PositionEffect = entry ? ExecutionFacts.Open : ExecutionFacts.Close, Price = price, Quantity = quantity,
                Fee = 0, FeeToken = "USDC", ClosedPnlUsd = pnl, OccurredAtUtc = At.AddMinutes(minute), TransactionHash = "",
            };
            Fills.Add(new(role, fill));
            Store.Fills.Add(fill);
            if (Store.Orders.All(o => o.ExternalOrderId != orderId))
                Store.Orders.Add(new()
                {
                    Id = Guid.NewGuid(), OwnerId = Account.OwnerId, AccountId = Account.Id, ExternalOrderId = orderId,
                    ContractId = "BTC", Side = side, OrderType = "Limit", LimitPrice = price, OriginalSize = quantity,
                    PlacedAtUtc = At, Status = "filled", VenueStatus = "filled", StatusAtUtc = At, ObservedAtUtc = At,
                });
            return fill;
        }

        public async Task<PlayExecutionDto> LinkAll()
        {
            PlayExecutionDto? result = null;
            foreach (var fill in Fills.DistinctBy(f => f.Fill.ExternalOrderId))
                result = await Service.LinkAsync(Play.Id, new(fill.Fill.ExternalOrderId,
                    fill.Role == OrderLinkRole.Entry ? "entry" : "exit", fill.Role == OrderLinkRole.Entry ? "entry-1" : null), default);
            return result!;
        }
    }
}
