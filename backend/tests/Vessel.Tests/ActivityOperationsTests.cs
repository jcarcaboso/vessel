using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using Vessel.Application.Activity;
using Vessel.Domain.Accounts;
using Vessel.Domain.Workspace;

namespace Vessel.Tests;

public sealed class ActivityOperationsTests
{
    private static readonly Guid Owner = Guid.NewGuid(), AccountId = Guid.NewGuid();
    private static readonly DateTimeOffset Start = new(2026, 10, 12, 0, 0, 0, TimeSpan.Zero);
    private static ImportedFill Fill(int n, string side = "buy", string effect = "open", decimal quantity = 1m,
        decimal price = 100m, decimal pnl = 0m, decimal fee = 0m, string basis = "gross", string token = "USDC", string? order = null) => new()
    {
        Id = Guid.NewGuid(), OwnerId = Owner, AccountId = AccountId, ContractId = "BTC", Side = side,
        Direction = "Display text must not control aggregation", PositionEffect = effect, Quantity = quantity, Price = price,
        ClosedPnlUsd = pnl, Fee = fee, FeeToken = token, PnlBasis = basis, FeeBasis = "reported",
        OccurredAtUtc = Start.AddMinutes(n), OrderId = order ?? n.ToString(), SourceFillId = n.ToString(), TransactionHash = ""
    };

    [Fact]
    public void Multi_order_entry_and_exit_form_one_round_trip()
    {
        List<ImportedFill> fills = [Fill(0), Fill(1, quantity: 2, price: 110), Fill(2, quantity: 2, price: 120)];
        fills.AddRange(Enumerable.Range(3, 5).Select(n => Fill(n, "sell", "close", price: 130, pnl: 4, fee: 0.1m)));
        var op = Assert.Single(OperationAggregator.Aggregate(fills.AsEnumerable().Reverse()));
        Assert.Equal("long", op.Direction); Assert.Equal("closed", op.Status);
        Assert.Equal("5", op.Quantity); Assert.Equal("5", op.TotalEnteredQuantity); Assert.Equal("5", op.TotalExitedQuantity);
        Assert.Equal("112", op.AverageEntryPrice); Assert.Equal("130", op.AverageExitPrice);
        Assert.Equal(3, op.EntryOrderCount); Assert.Equal(5, op.ExitOrderCount); Assert.Equal(8, op.FillCount);
        Assert.Equal("20", op.ReportedClosedPnlUsd); Assert.Equal("19.5", op.NetResultUsd);
        Assert.Equal(Start, op.OpenedAtUtc); Assert.Equal(Start.AddMinutes(7), op.ClosedAtUtc);
    }

    [Fact]
    public void Partial_closes_and_reentry_track_peak_not_total_entered()
    {
        var op = Assert.Single(OperationAggregator.Aggregate([Fill(0, quantity: 3), Fill(1, "sell", "close", quantity: 2),
            Fill(2, quantity: 1), Fill(3, "sell", "close", quantity: 1)]));
        Assert.Equal("open", op.Status); Assert.Equal("3", op.Quantity); Assert.Equal("4", op.TotalEnteredQuantity);
        Assert.Equal("3", op.TotalExitedQuantity); Assert.Equal("1", op.OpenQuantity); Assert.Null(op.ClosedAtUtc);
    }

    [Fact]
    public void Flips_allocate_all_money_to_close_and_preserve_original_fill()
    {
        var opening = Fill(0, quantity: 2, fee: 0.1m);
        var flip = Fill(1, "sell", "flip", quantity: 5, pnl: 10, fee: 0.5m);
        var exit = Fill(2, "buy", "close", quantity: 3, pnl: 6, fee: 0.2m);
        var ops = OperationAggregator.Aggregate([opening, flip, exit]);
        var longOp = ops.Single(o => o.Direction == "long"); var shortOp = ops.Single(o => o.Direction == "short");
        Assert.Equal("closed", longOp.Status); Assert.Equal("closed", shortOp.Status);
        Assert.Equal("2", longOp.Fills[1].Quantity); Assert.Equal("0.5", longOp.Fills[1].Fee);
        Assert.Equal("3", shortOp.Fills[0].Quantity); Assert.Equal("0", shortOp.Fills[0].Fee); Assert.Equal("0", shortOp.Fills[0].ClosedPnlUsd);
        Assert.Equal("5", shortOp.Fills[0].Fill.Quantity); Assert.Equal("0.5", shortOp.Fills[0].Fill.Fee);
        Assert.Equal("9.4", longOp.NetResultUsd); Assert.Equal("5.8", shortOp.NetResultUsd);
        Assert.Equal("5", flip.Quantity.ToString()); Assert.Equal(16m - 0.8m, decimal.Parse(longOp.NetResultUsd!) + decimal.Parse(shortOp.NetResultUsd!));
    }

    [Fact]
    public void Net_of_fee_and_gross_fills_are_not_charged_twice()
    {
        var op = Assert.Single(OperationAggregator.Aggregate([Fill(0, fee: 1), Fill(1, "sell", "close", pnl: 10, fee: 2, basis: "net-of-fee")]));
        Assert.Equal("9", op.NetResultUsd); Assert.Equal("3", op.StablecoinFeesNominalUsd); Assert.Equal("mixed", op.PnlBasis);
        var net = Assert.Single(OperationAggregator.Aggregate([Fill(0, basis: "net-of-fee", token: "ETH", fee: 1),
            Fill(1, "sell", "close", basis: "net-of-fee", token: "ETH", fee: 2, pnl: 10)]));
        Assert.Equal("10", net.NetResultUsd); Assert.Equal("3", Assert.Single(net.OtherFees).Amount);
    }

    [Fact]
    public void Unsupported_gross_fees_leave_net_unknown_without_conversion()
    {
        var op = Assert.Single(OperationAggregator.Aggregate([Fill(0, fee: 1, token: "ETH")]));
        Assert.Null(op.NetResultUsd); Assert.Equal("ETH", Assert.Single(op.OtherFees).Token); Assert.NotEmpty(op.Coverage);
        var stable = Assert.Single(OperationAggregator.Aggregate([Fill(0, fee: 1, token: "USDT")]));
        Assert.Equal("1", stable.StablecoinFeesNominalUsd); Assert.Null(stable.NetResultUsd);
    }

    [Theory]
    [InlineData("sell", "close")]
    [InlineData("buy", "flip")]
    [InlineData("buy", "unknown")]
    public void Missing_initial_history_is_incomplete_and_never_guesses_a_starting_position(string side, string effect)
    {
        var op = Assert.Single(OperationAggregator.Aggregate([Fill(0, side, effect), Fill(1)]));
        Assert.Equal("incomplete", op.Status); Assert.Null(op.Direction); Assert.Null(op.OpenedAtUtc);
        Assert.Null(op.Quantity); Assert.Null(op.OpenQuantity); Assert.Null(op.TotalEnteredQuantity); Assert.Null(op.AverageEntryPrice);
        Assert.Equal(2, op.FillCount); Assert.NotEmpty(op.Coverage);
    }

    [Theory]
    [InlineData("buy", "close", 1)]
    [InlineData("sell", "close", 3)]
    [InlineData("sell", "flip", 1)]
    [InlineData("sell", "open", 1)]
    [InlineData("sell", "unknown", 1)]
    public void Contradictions_quarantine_the_remaining_contract_history(string side, string effect, int quantity)
    {
        var op = Assert.Single(OperationAggregator.Aggregate([Fill(0, quantity: 2), Fill(1, side, effect, quantity), Fill(2)]));
        Assert.Equal("incomplete", op.Status); Assert.Equal(3, op.FillCount); Assert.Null(op.AverageExitPrice);
    }

    [Fact]
    public void Differing_scales_and_very_large_totals_are_exact()
    {
        var large = Fill(0, quantity: decimal.MaxValue, price: 1, fee: decimal.MaxValue, pnl: decimal.MaxValue);
        var tiny = Fill(1, quantity: 0.0000000000000000000000000001m, price: 1, fee: 0.0000000000000000000000000001m, pnl: 0.0000000000000000000000000001m);
        var op = Assert.Single(OperationAggregator.Aggregate([large, tiny]));
        const string expected = "79228162514264337593543950335.0000000000000000000000000001";
        Assert.Equal(expected, op.Quantity); Assert.Equal(expected, op.ReportedClosedPnlUsd);
        Assert.Equal(expected, op.StablecoinFeesNominalUsd); Assert.Equal("0", op.NetResultUsd); Assert.Equal("1", op.AverageEntryPrice);
    }

    [Fact]
    public void Weighted_averages_round_nonterminating_results_at_28_places()
    {
        var op = Assert.Single(OperationAggregator.Aggregate([Fill(0, price: 1), Fill(1, quantity: 2, price: 2)]));
        Assert.Equal("1.6666666666666666666666666667", op.AverageEntryPrice);
    }

    [Fact]
    public void Only_a_fully_linked_single_play_is_associated()
    {
        var a = Fill(0); var b = Fill(1, "sell", "close"); var play = Guid.NewGuid();
        var op = Assert.Single(OperationAggregator.Aggregate([a, b], new Dictionary<Guid, Guid> { [a.Id] = play, [b.Id] = play }));
        Assert.Equal(play, op.PlayId); Assert.Equal("linked", op.PlayAssociation);
        op = Assert.Single(OperationAggregator.Aggregate([a, b], new Dictionary<Guid, Guid> { [a.Id] = play }));
        Assert.Null(op.PlayId); Assert.Equal("mixed", op.PlayAssociation);
        op = Assert.Single(OperationAggregator.Aggregate([a, b], new Dictionary<Guid, Guid> { [a.Id] = play, [b.Id] = Guid.NewGuid() }));
        Assert.Equal("mixed", op.PlayAssociation); Assert.Null(op.PlayId);
    }

    [Fact]
    public void Distinct_orders_are_counted_once_across_partial_fills()
    {
        var op = Assert.Single(OperationAggregator.Aggregate([Fill(0, order: "entry"), Fill(1, order: "entry"),
            Fill(2, "sell", "close", order: "exit"), Fill(3, "sell", "close", order: "exit")]));
        Assert.Equal(1, op.EntryOrderCount); Assert.Equal(1, op.ExitOrderCount); Assert.Equal(4, op.FillCount);
    }

    [Fact]
    public void Opposing_timestamp_ties_do_not_use_random_ids_to_invent_a_round_trip()
    {
        var entry = Fill(0); var exit = Fill(0, "sell", "close");
        var op = Assert.Single(OperationAggregator.Aggregate([entry, exit]));
        Assert.Equal("incomplete", op.Status); Assert.Null(op.Quantity);
        Assert.Contains(op.Coverage, c => c.Contains("timestamp"));
    }

    [Fact]
    public void Different_contracts_and_accounts_never_merge_and_closed_history_survives_later_ambiguity()
    {
        var other = Fill(0); other.ContractId = "ETH";
        var otherAccount = Fill(0); otherAccount.AccountId = Guid.NewGuid();
        var ops = OperationAggregator.Aggregate([Fill(0), Fill(1, "sell", "close"), Fill(2, effect: "unknown"), other, otherAccount]);
        Assert.Equal(4, ops.Count); Assert.Single(ops, o => o.Status == "closed"); Assert.Single(ops, o => o.Status == "incomplete");
    }

    [Fact]
    public async Task Snapshot_older_than_fills_is_not_treated_as_a_position_disagreement()
    {
        var snapshot = new AccountSnapshot { AccountId = AccountId, ObservedAtUtc = Start, Positions = [] };
        var result = await new ActivityService(new Store(new([Account(AccountId)], [Fill(1)], [snapshot], new Dictionary<Guid, Guid>())))
            .GetAsync(null, default);
        Assert.Contains(result.Coverage, c => c.Notice.Contains("predates"));
        Assert.DoesNotContain(result.Coverage, c => c.Notice.Contains("disagrees"));
    }

    private static Account Account(Guid id, bool enabled = true)
    {
        var account = new Account(id, Owner, "manual", "Fixture");
        account.UpdateSettings(account.Name, null, enabled);
        return account;
    }
    private sealed class Store(ActivityFacts facts) : IActivityStore
    {
        public Task<ActivityFacts> ReadAsync(Guid? accountId, CancellationToken ct) => Task.FromResult(facts);
    }

    [Fact]
    public async Task Service_uses_more_than_100_retained_fills_and_excludes_disabled_accounts()
    {
        var disabled = Guid.NewGuid(); var foreign = Guid.NewGuid();
        var fills = Enumerable.Range(0, 120).Select(n => Fill(n, n % 2 == 0 ? "buy" : "sell", n % 2 == 0 ? "open" : "close")).ToList();
        var hidden = Fill(130); hidden.AccountId = disabled; fills.Add(hidden);
        var outside = Fill(131); outside.AccountId = foreign; fills.Add(outside);
        var service = new ActivityService(new Store(new([Account(AccountId), Account(disabled, false)], fills, [], new Dictionary<Guid, Guid>())));
        var result = await service.GetAsync(null, default);
        Assert.Equal(120, result.RetainedFillCount); Assert.Equal(60, result.TotalOperationCount);
        Assert.All(result.Operations, o => Assert.Equal(AccountId, o.AccountId));
    }

    [Fact]
    public async Task Snapshot_disagreement_is_coverage_not_a_position_correction()
    {
        var snapshot = new AccountSnapshot { AccountId = AccountId, ObservedAtUtc = Start.AddDays(1), Positions =
            [new() { ContractId = "BTC", SignedQuantity = 3 }, new() { ContractId = "ETH", SignedQuantity = -2 }] };
        var result = await new ActivityService(new Store(new([Account(AccountId)], [Fill(0)], [snapshot], new Dictionary<Guid, Guid>())))
            .GetAsync(null, default);
        var op = Assert.Single(result.Operations); Assert.Equal("open", op.Status); Assert.Equal("1", op.OpenQuantity);
        Assert.Contains(op.Coverage, s => s.Contains("disagrees")); Assert.Equal(2, result.Coverage.Count);
    }

    [Fact]
    public async Task Response_limits_never_change_aggregate_totals()
    {
        var fills = Enumerable.Range(0, 250).Select(n => Fill(n)).ToList();
        var result = await new ActivityService(new Store(new([Account(AccountId)], fills, [], new Dictionary<Guid, Guid>()))).GetAsync(null, default);
        var op = Assert.Single(result.Operations); Assert.Equal("250", op.Quantity); Assert.Equal(250, op.FillCount);
        Assert.Equal(200, op.Fills.Count); Assert.Equal(50, op.OmittedFillCount);
        fills = Enumerable.Range(0, 1100).Select(n => Fill(n, n % 2 == 0 ? "buy" : "sell", n % 2 == 0 ? "open" : "close")).ToList();
        result = await new ActivityService(new Store(new([Account(AccountId)], fills, [], new Dictionary<Guid, Guid>()))).GetAsync(null, default);
        Assert.Equal(500, result.Operations.Count); Assert.Equal(50, result.OmittedOperationCount);
    }

    [Fact]
    public async Task Activity_endpoint_requires_authentication_before_reading_facts()
    {
        await using var factory = new CoreApiFactory(Owner); using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/activity")).StatusCode);
    }

    [Fact]
    public async Task Activity_endpoint_has_exact_payload_no_store_and_account_filter()
    {
        var store = new Store(new([Account(AccountId)], [Fill(0), Fill(1, "sell", "close", pnl: 0.0000000000000000000000000001m)], [], new Dictionary<Guid, Guid>()));
        await using var factory = new CoreApiFactory(Owner, configure: services => services.AddSingleton<IActivityStore>(store));
        using var client = factory.AuthorizedClient();
        var response = await client.GetAsync($"/api/activity?accountId={AccountId}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode); Assert.True(response.Headers.CacheControl?.NoStore);
        var document = (await response.Content.ReadFromJsonAsync<ActivityDto>())!;
        Assert.Equal("0.0000000000000000000000000001", Assert.Single(document.Operations).NetResultUsd);
        Assert.Empty((await client.GetFromJsonAsync<ActivityDto>($"/api/activity?accountId={Guid.NewGuid()}"))!.Operations);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/activity?accountId=not-a-guid")).StatusCode);
    }
}
