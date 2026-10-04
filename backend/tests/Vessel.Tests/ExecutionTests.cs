using Microsoft.EntityFrameworkCore;
using Vessel.Application.Plays;
using Vessel.Application.Plays.Execution;
using Vessel.Application.Venues;
using Vessel.Application.Workspace;
using Vessel.Domain.Accounts;
using Vessel.Domain.Markets;
using Vessel.Domain.Plays;
using Vessel.Domain.Workspace;
using Vessel.Infrastructure.Venues.Hyperliquid;
using Vessel.Persistence;

namespace Vessel.Tests;

internal sealed class FakeOrderReader : IVenueOrderReader
{
    public string VenueId => "hyperliquid";
    public List<VenueOrder> Orders { get; } = [];
    public bool Fail { get; set; }
    public Task<VenueOrderReadResult> ReadOrdersAsync(string publicAddress, CancellationToken ct) => Fail
        ? Task.FromException<VenueOrderReadResult>(new VenueReadException("secret failure"))
        : Task.FromResult(new VenueOrderReadResult(Orders.ToList(), DateTimeOffset.UtcNow, "notice"));
}

public sealed class ExecutionMatcherTests
{
    private static readonly DateTimeOffset Created = DateTimeOffset.Parse("2026-10-03T10:00:00Z");
    private readonly Account account = new(Guid.NewGuid(), Guid.NewGuid(), "hyperliquid", "Trading");

    private Play Planned(PlayPlanDocument? plan = null, string contract = "BTC")
    {
        var play = new Play(Guid.NewGuid(), account, new PerpetualInstrument("hyperliquid", contract), InstrumentSource.Venue,
            PlayDocuments.Serialize(plan ?? TestPlays.Plan()), Created);
        play.MarkPlanned(Created);
        return play;
    }

    private static ImportedOrder Order(string side, decimal price, decimal? trigger = null, string type = "Limit", bool reduceOnly = false,
        string contract = "BTC", DateTimeOffset? placed = null) => new()
    {
        OrderId = "1", ContractId = contract, Side = side, OrderType = type, LimitPrice = price, TriggerPrice = trigger,
        ReduceOnly = reduceOnly, PlacedAtUtc = placed ?? Created.AddMinutes(1), Status = "open", VenueStatus = "open",
    };

    private static List<MatchCandidate> Match(ImportedOrder order, params Play[] plays) => ExecutionMatcher.Candidates(order,
        plays.Select(p => (p, PlayDocuments.Read(p.Plan))), (_, _) => false, closesPosition: false);

    [Fact]
    public void Matches_entries_stops_and_targets_by_side_price_and_order_kind()
    {
        var play = Planned();
        Assert.Equal("entry|entry-1", Assert.Single(Match(Order("B", 100.01m), play)).Level.Key);
        Assert.Empty(Match(Order("B", 100.02m), play));
        Assert.Empty(Match(Order("A", 100m), play));
        Assert.Equal("stop|entry-1|stop-1", Assert.Single(Match(Order("A", 94m, 95m, "Stop Market", true), play)).Level.Key);
        // A resting limit at the stop price is not a stop.
        Assert.Empty(Match(Order("A", 95m, reduceOnly: true), play));
        Assert.Equal("target|entry-1|target-1", Assert.Single(Match(Order("A", 110m, reduceOnly: true), play)).Level.Key);
        Assert.Equal("target|entry-1|target-1", Assert.Single(Match(Order("A", 109m, 110m, "Take Profit Market", true), play)).Level.Key);
        // A reduce-only buy is not a long entry.
        Assert.Empty(Match(Order("B", 100m, reduceOnly: true), play));
    }

    [Fact]
    public void Resolves_percent_levels_as_returns_at_the_plan_leverage_and_short_sides()
    {
        var plan = TestPlays.Plan() with
        {
            Direction = "short", Leverage = "1",
            Entries = [TestPlays.Plan().Entries[0] with { Stops = [new PlanExit("stop-1", "percent", "5", "100")], Targets = [new PlanExit("target-1", "percent", "10", "100")] }],
        };
        var play = Planned(plan);
        Assert.Single(Match(Order("A", 100m), play));
        Assert.Equal("stop|entry-1|stop-1", Assert.Single(Match(Order("B", 106m, 105m, "Stop Market", true), play)).Level.Key);
        Assert.Equal("target|entry-1|target-1", Assert.Single(Match(Order("B", 90m, reduceOnly: true), play)).Level.Key);

        // At 5x, a 5% loss on margin is a 1% move and a 10% gain is a 2% move.
        var levered = Planned(plan with { Leverage = "5" });
        Assert.Empty(Match(Order("B", 106m, 105m, "Stop Market", true), levered));
        Assert.Equal("stop|entry-1|stop-1", Assert.Single(Match(Order("B", 102m, 101m, "Stop Market", true), levered)).Level.Key);
        Assert.Equal("target|entry-1|target-1", Assert.Single(Match(Order("B", 98m, reduceOnly: true), levered)).Level.Key);
    }

    [Fact]
    public void Each_stop_of_an_entry_is_its_own_level()
    {
        var plan = TestPlays.Plan() with
        {
            Entries = [TestPlays.Plan().Entries[0] with { Stops = [new PlanExit("stop-1", "price", "95", "50"), new PlanExit("stop-2", "price", "90", "50")] }],
        };
        var play = Planned(plan);
        Assert.Equal("stop|entry-1|stop-1", Assert.Single(Match(Order("A", 94m, 95m, "Stop Market", true), play)).Level.Key);
        Assert.Equal("stop|entry-1|stop-2", Assert.Single(Match(Order("A", 89m, 90m, "Stop Market", true), play)).Level.Key);
    }

    [Fact]
    public void Concurrent_plays_on_one_level_are_ambiguous_and_old_or_other_orders_are_ignored()
    {
        var first = Planned();
        var second = Planned();
        Assert.Equal(2, Match(Order("B", 100m), first, second).Count);
        Assert.Empty(Match(Order("B", 100m, placed: Created.AddMinutes(-1)), first));
        Assert.Empty(Match(Order("B", 100m, contract: "ETH"), first));
        var dismissed = ExecutionMatcher.Candidates(Order("B", 100m), [(first, PlayDocuments.Read(first.Plan)), (second, PlayDocuments.Read(second.Plan))],
            (play, _) => play == first, false);
        Assert.Same(second, Assert.Single(dismissed).Play);
    }

    [Fact]
    public void Unplanned_exits_need_an_open_play_and_a_reducing_order()
    {
        var play = Planned();
        Assert.Empty(ExecutionMatcher.Candidates(Order("A", 103m), [(play, PlayDocuments.Read(play.Plan))], (_, _) => false, true));
        play.MarkOpen("Entry fill.", Created);
        var plays = new[] { (play, PlayDocuments.Read(play.Plan)) };
        Func<Play, DateTimeOffset?> opened = _ => Created.AddSeconds(30);
        Assert.Empty(ExecutionMatcher.Candidates(Order("A", 103m), plays, (_, _) => false, false, opened));
        Assert.Equal("exit", Assert.Single(ExecutionMatcher.Candidates(Order("A", 103m), plays, (_, _) => false, true, opened)).Level.Key);
        // An exit placed before the play's first entry fill belongs to something else.
        Assert.Empty(ExecutionMatcher.Candidates(Order("A", 103m, placed: Created.AddSeconds(10)), plays, (_, _) => false, true, opened));
    }

    [Theory]
    [InlineData(84541, 84541, true)]
    [InlineData(84542, 84541, true)]
    [InlineData(84543, 84541, false)]
    [InlineData(82850, 82850.18, true)]
    [InlineData(100.01, 100, true)]
    [InlineData(0.0012346, 0.0012345, true)]
    [InlineData(0.0012347, 0.0012345, false)]
    public void Prices_match_within_one_fifth_significant_figure_step(double actual, double planned, bool near) =>
        Assert.Equal(near, ExecutionMatcher.Near((decimal)actual, (decimal)planned));

    [Theory]
    [InlineData("open", VenueOrderStatus.Open)]
    [InlineData("filled", VenueOrderStatus.Filled)]
    [InlineData("canceled", VenueOrderStatus.Canceled)]
    [InlineData("marginCanceled", VenueOrderStatus.Canceled)]
    [InlineData("badAloPxRejected", VenueOrderStatus.Rejected)]
    [InlineData("triggered", VenueOrderStatus.Triggered)]
    [InlineData("somethingNew", VenueOrderStatus.Other)]
    public void Normalizes_hyperliquid_order_statuses(string status, VenueOrderStatus expected) =>
        Assert.Equal(expected, HyperliquidPerpetualReader.Normalize(status));
}

public sealed class ExecutionPostgresTests
{
    private sealed class Harness(VesselDbContext db, Guid owner, FixtureReader reader, FakeOrderReader orders)
    {
        public VesselDbContext Db => db;
        public FixtureReader Reader => reader;
        public FakeOrderReader Orders => orders;
        public WorkspaceService Workspace { get; } = new(new WorkspaceStore(db), new CoreOwner(owner), reader);
        public PlayService Plays { get; } = new(new PlayStore(db), new MemoryObjectStore(), TimeProvider.System);
        public PlayExecutionService Execution => new(new PlayStore(db), new ExecutionStore(db), Workspace, orders, TimeProvider.System);
    }

    private static async Task<(CoreDatabase Database, Harness Harness, Guid Account)> SetUp()
    {
        var database = await CoreDatabase.CreateAsync();
        var owner = Guid.NewGuid();
        var reader = new FixtureReader();
        reader.Result = reader.Result with { Fills = [] };
        var harness = new Harness(database.Context(owner), owner, reader, new FakeOrderReader());
        var account = await harness.Workspace.CreateAccountAsync(new(null, "Venue", "hyperliquid", "0x" + Guid.NewGuid().ToString("N") + "00000000"), default);
        return (database, harness, account.Id);
    }

    private static async Task<PlayDto> PlannedPlay(Harness h, Guid account, string title = "Breakout")
    {
        var play = await h.Plays.CreateAsync(new CreatePlayRequest(account, "BTC", "venue", title, TestPlays.Plan()), default);
        return await h.Plays.ChangeStatusAsync(play.Summary.Id, new(play.Summary.Version, "planned"), default);
    }

    private static VenueOrder Order(string id, string side, decimal price, string status = "open", decimal? trigger = null,
        string type = "Limit", bool reduceOnly = false, int placedLater = 0) => new(id, "BTC", side, type, price, trigger, reduceOnly, false, 1m,
        status == "open" ? 1m : 0m, DateTimeOffset.UtcNow.AddSeconds(placedLater), HyperliquidPerpetualReader.Normalize(status), status, DateTimeOffset.UtcNow);

    private static VenueFill Fill(string id, string orderId, string dir, decimal price, decimal quantity) =>
        new(id, "BTC", dir.Contains("Long") == dir.StartsWith("Open") ? "B" : "A", dir, price, quantity, 0.01m, "USDC",
            dir.StartsWith("Close") ? 5m : 0m, DateTimeOffset.UtcNow, orderId, "hash-" + id, "{}");

    [PostgresFact]
    public async Task Links_orders_automatically_and_opens_then_closes_from_linked_fills()
    {
        var (database, h, account) = await SetUp();
        await using var _ = database;
        var play = await PlannedPlay(h, account);
        h.Orders.Orders.AddRange([Order("11", "B", 100.01m), Order("12", "A", 94m, trigger: 95m, type: "Stop Market", reduceOnly: true),
            Order("13", "A", 110m, reduceOnly: true), Order("14", "B", 80m)]);
        var execution = await h.Execution.CheckAsync(play.Summary.Id, default);
        Assert.Equal(["entry", "stop", "target"], execution.Links.Select(l => l.Role));
        Assert.All(execution.Links, l => Assert.Equal(("linked", "automatic"), (l.State, l.Source)));
        Assert.Equal("14", Assert.Single(execution.UnlinkedOrders).OrderId);
        Assert.Equal(("planned", 1), (execution.Status, execution.Entries.Single().RestingOrders));

        h.Orders.Orders[0] = Order("11", "B", 100.01m, "filled");
        h.Reader.Result = h.Reader.Result with { Fills = [Fill("f1", "11", "Open Long", 100m, 0.5m)] };
        execution = await h.Execution.CheckAsync(play.Summary.Id, default);
        Assert.Equal(("open", "0.5", "0.5", "100"), (execution.Status, execution.Totals.EnteredQuantity, execution.Totals.OpenQuantity,
            execution.Entries.Single().AverageFillPrice));

        h.Orders.Orders[2] = Order("13", "A", 110m, "filled", reduceOnly: true);
        h.Reader.Result = h.Reader.Result with { Fills = [Fill("f1", "11", "Open Long", 100m, 0.5m), Fill("f2", "13", "Close Long", 110m, 0.5m)] };
        execution = await h.Execution.CheckAsync(play.Summary.Id, default);
        Assert.Equal(("closed", "0", "5"), (execution.Status, execution.Totals.OpenQuantity, execution.Totals.ClosedPnlUsd));
        Assert.Equal("0.02", Assert.Single(execution.Totals.Fees).Amount);

        var history = await h.Plays.HistoryAsync(play.Summary.Id, default);
        Assert.Equal(["planned", "open", "closed"], history.StatusChanges.Select(c => c.To));
        Assert.Contains("order 11", history.StatusChanges[1].Note);
        var stored = await h.Db.StatusChanges.Where(c => c.PlayId == play.Summary.Id).OrderBy(c => c.OccurredAtUtc).ToListAsync();
        Assert.Equal([StatusChangeSource.Owner, StatusChangeSource.Venue, StatusChangeSource.Venue], stored.Select(c => c.Source));
    }

    [PostgresFact]
    public async Task Ambiguous_orders_wait_for_the_owner_and_dismissals_stick()
    {
        var (database, h, account) = await SetUp();
        await using var _ = database;
        var first = await PlannedPlay(h, account, "First");
        var second = await PlannedPlay(h, account, "Second");
        h.Orders.Orders.Add(Order("21", "B", 100m));
        var execution = await h.Execution.CheckAsync(first.Summary.Id, default);
        Assert.Empty(execution.Links);
        var suggestion = Assert.Single(execution.Suggestions);
        Assert.Single((await h.Execution.GetAsync(second.Summary.Id, default)).Suggestions);

        execution = await h.Execution.LinkAsync(first.Summary.Id, new("21", "entry", "entry-1"), default);
        Assert.Equal(("linked", "owner"), (execution.Links.Single().State, execution.Links.Single().Source));
        Assert.Empty((await h.Execution.GetAsync(second.Summary.Id, default)).Suggestions);
        await Assert.ThrowsAsync<WorkspaceException>(() => h.Execution.LinkAsync(second.Summary.Id, new("21", "entry", "entry-1"), default));

        // Unlinking is remembered: the next check does not link it again.
        execution = await h.Execution.UnlinkAsync(first.Summary.Id, execution.Links.Single().Id, default);
        Assert.Empty(execution.Links);
        await h.Execution.CheckAsync(first.Summary.Id, default);
        Assert.Empty((await h.Execution.GetAsync(first.Summary.Id, default)).Links);
        Assert.Single((await h.Execution.GetAsync(second.Summary.Id, default)).Links);
        Assert.NotEqual(Guid.Empty, suggestion.Id);
    }

    [PostgresFact]
    public async Task The_owner_links_an_order_to_one_of_several_stops()
    {
        var (database, h, account) = await SetUp();
        await using var _ = database;
        var plan = TestPlays.Plan() with
        {
            Entries = [TestPlays.Plan().Entries[0] with { Stops = [new PlanExit("stop-1", "price", "95", "50"), new PlanExit("stop-2", "price", "90", "50")] }],
        };
        var draft = await h.Plays.CreateAsync(new CreatePlayRequest(account, "BTC", "venue", "Two stops", plan), default);
        var play = await h.Plays.ChangeStatusAsync(draft.Summary.Id, new(draft.Summary.Version, "planned"), default);
        h.Orders.Orders.AddRange([Order("41", "A", 89m, trigger: 90m, type: "Stop Market", reduceOnly: true), Order("42", "A", 80m, trigger: 85m, type: "Stop Market", reduceOnly: true)]);
        var execution = await h.Execution.CheckAsync(play.Summary.Id, default);
        var automatic = Assert.Single(execution.Links);
        Assert.Equal(("41", "stop", "stop-2"), (automatic.Order!.OrderId, automatic.Role, automatic.LevelId));

        await Assert.ThrowsAsync<WorkspaceException>(() => h.Execution.LinkAsync(play.Summary.Id, new("42", "stop", "entry-1", "target-1"), default));
        execution = await h.Execution.LinkAsync(play.Summary.Id, new("42", "stop", "entry-1", "stop-1"), default);
        Assert.Equal(["stop-1", "stop-2"], execution.Links.Select(l => l.LevelId));
    }

    [PostgresFact]
    public async Task Unplanned_closes_and_filled_entries_are_protected()
    {
        var (database, h, account) = await SetUp();
        await using var _ = database;
        var play = await PlannedPlay(h, account);
        h.Orders.Orders.AddRange([Order("31", "B", 100m, "filled"), Order("32", "A", 103m, "filled", placedLater: 5)]);
        h.Reader.Result = h.Reader.Result with { Fills = [Fill("f1", "31", "Open Long", 100m, 1m), Fill("f2", "32", "Close Long", 103m, 1m)] };
        var execution = await h.Execution.CheckAsync(play.Summary.Id, default);
        Assert.Equal(["entry", "exit"], execution.Links.Select(l => l.Role));
        Assert.Equal("closed", execution.Status);

        // The closed plan is fixed; on an open play only unfilled entries could move.
        var current = await h.Plays.GetAsync(play.Summary.Id, default);
        Assert.Equal("closed", current.Summary.Status);
        var moved = TestPlays.Plan("101");
        Assert.Equal(409, (await Assert.ThrowsAsync<WorkspaceException>(() => h.Plays.UpdateAsync(play.Summary.Id,
            new(current.Summary.Version, account, "BTC", "venue", current.Summary.Title, moved, current.Drawings, "", "Chased"), default))).StatusCode);
    }

    [PostgresFact]
    public async Task Filled_entry_price_cannot_be_revised_but_stops_can()
    {
        var (database, h, account) = await SetUp();
        await using var _ = database;
        var play = await PlannedPlay(h, account);
        h.Orders.Orders.Add(Order("41", "B", 100m, "filled"));
        h.Reader.Result = h.Reader.Result with { Fills = [Fill("f1", "41", "Open Long", 100m, 0.2m)] };
        Assert.Equal("open", (await h.Execution.CheckAsync(play.Summary.Id, default)).Status);
        var current = await h.Plays.GetAsync(play.Summary.Id, default);
        var error = await Assert.ThrowsAsync<WorkspaceException>(() => h.Plays.UpdateAsync(play.Summary.Id,
            new(current.Summary.Version, account, "BTC", "venue", current.Summary.Title, TestPlays.Plan("101"), current.Drawings, "", "Chased"), default));
        Assert.Contains("has fills", error.Message);
        var revised = await h.Plays.UpdateAsync(play.Summary.Id,
            new(current.Summary.Version, account, "BTC", "venue", current.Summary.Title, TestPlays.Plan(stop: "97"), current.Drawings, "", "Trail"), default);
        Assert.Equal(2, revised.Summary.PlanRevision);
    }

    [PostgresFact]
    public async Task Untracked_plays_explain_why_and_venue_failures_are_safe()
    {
        var (database, h, account) = await SetUp();
        await using var _ = database;
        var manual = await h.Plays.CreateAsync(new CreatePlayRequest(account, "My label", "manual", "Manual", TestPlays.Plan()), default);
        Assert.Equal("Plan the play to start tracking venue orders.", (await h.Execution.GetAsync(manual.Summary.Id, default)).Reason);
        manual = await h.Plays.ChangeStatusAsync(manual.Summary.Id, new(manual.Summary.Version, "planned"), default);
        var execution = await h.Execution.GetAsync(manual.Summary.Id, default);
        Assert.False(execution.Tracked);
        Assert.Equal(409, (await Assert.ThrowsAsync<WorkspaceException>(() => h.Execution.CheckAsync(manual.Summary.Id, default))).StatusCode);

        var play = await PlannedPlay(h, account);
        h.Orders.Fail = true;
        var failure = await Assert.ThrowsAsync<WorkspaceException>(() => h.Execution.CheckAsync(play.Summary.Id, default));
        Assert.Equal(502, failure.StatusCode);
        Assert.DoesNotContain("secret", failure.Message);
    }
}
