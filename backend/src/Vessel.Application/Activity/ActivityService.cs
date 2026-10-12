using Vessel.Application.Workspace;

namespace Vessel.Application.Activity;

public sealed class ActivityService(IActivityStore store)
{
    public const int MaxOperations = 500, MaxFillsPerOperation = 200, MaxResponseFills = 10_000;
    public const string ScopeNote = "Position round trips from all retained fills on enabled accounts, not trading intent or retrospective Plays. " +
        "Retained history is bounded by venue imports; balanced fills do not prove lifetime coverage. Newest activity first. " +
        "At most 500 operations and 10,000 allocated fill rows, up to 200 per operation. Totals include omitted rows. " +
        "Quantities, sums and flip allocations are exact. Weighted prices round only when necessary to 28 decimal places, halfway away from zero. " +
        "Stablecoin fees are nominal token units, not FX values. Net result subtracts only USDC fees on gross fills; net-of-fee P&L is not charged twice. " +
        "Separate funding cashflows are not added, and RISEx reported funding inclusion remains unverified.";

    public async Task<ActivityDto> GetAsync(Guid? accountId, CancellationToken ct)
    {
        if (accountId == Guid.Empty) throw new WorkspaceException(400, "Choose a valid account.");
        var facts = await store.ReadAsync(accountId, ct);
        var accounts = facts.Accounts.Where(a => a.IsEnabled && (accountId == null || a.Id == accountId)).ToDictionary(a => a.Id);
        var fills = facts.Fills.Where(f => accounts.ContainsKey(f.AccountId)).ToList();
        var operations = OperationAggregator.Aggregate(fills, facts.FillPlayIds, facts.Snapshots).ToList();
        var coverage = new List<ActivityCoverageDto>();
        foreach (var account in accounts.Values)
        {
            if (account.HistoryNotice is { Length: > 0 } notice) coverage.Add(new(account.Id, null, notice));
            var snapshot = facts.Snapshots.SingleOrDefault(s => s.AccountId == account.Id);
            if (snapshot is null) { coverage.Add(new(account.Id, null, "No latest position snapshot is available for comparison.")); continue; }
            var contracts = fills.Where(f => f.AccountId == account.Id).Select(f => f.ContractId)
                .Concat(snapshot.Positions.Select(p => p.ContractId)).Distinct(StringComparer.Ordinal);
            foreach (var contract in contracts)
            {
                // A close and the next open can have identical last timestamps. The remaining
                // position, not UUID display ordering, identifies the final operation.
                var last = operations.Where(o => o.AccountId == account.Id && o.ContractId == contract)
                    .OrderByDescending(o => o.LastOccurredAtUtc).ThenBy(o => o.OpenQuantity == "0" ? 1 : 0).FirstOrDefault();
                string? reason = last?.LastOccurredAtUtc > snapshot.ObservedAtUtc ? "Latest snapshot predates retained fills; position comparison is unavailable." :
                    last is not null && last.OpenQuantity is null ? "Computed position is unknown because retained history is incomplete; snapshot comparison is unavailable." : null;
                if (reason is null)
                {
                    var observed = ExactAmount.From(snapshot.Positions.SingleOrDefault(p => p.ContractId == contract)?.SignedQuantity ?? 0m);
                    var computedText = last?.OpenQuantity ?? "0";
                    // Compare exact strings after normalizing through the aggregator's own signed position.
                    var signed = last?.Direction == "short" && computedText != "0" ? "-" + computedText : computedText;
                    if (observed.ToString() != signed)
                        reason = $"Latest snapshot position {observed} disagrees with retained-fill position {signed}. Neither is corrected.";
                }
                if (reason is not null)
                {
                    coverage.Add(new(account.Id, contract, reason));
                    if (last is not null)
                    {
                        var index = operations.IndexOf(last);
                        operations[index] = last with { Coverage = last.Coverage.Append(reason).ToList() };
                    }
                }
            }
        }
        var budget = MaxResponseFills;
        var bounded = operations.Take(MaxOperations).Select(o =>
        {
            var take = Math.Min(budget, Math.Min(o.Fills.Count, MaxFillsPerOperation));
            budget -= take;
            return o with { Fills = o.Fills.Take(take).ToList(), OmittedFillCount = o.Fills.Count - take };
        }).ToList();
        return new(bounded, operations.Count, fills.Count, operations.Count - bounded.Count, coverage, ScopeNote);
    }
}
