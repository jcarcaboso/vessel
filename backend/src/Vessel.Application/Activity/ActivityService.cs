using Vessel.Application.Common;

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
        var summary = await ReadSummariesAsync(accountId, ct);
        var budget = MaxResponseFills;
        var bounded = summary.Operations.Take(MaxOperations).Select(o =>
        {
            var take = Math.Min(budget, Math.Min(o.Fills.Count, MaxFillsPerOperation));
            budget -= take;
            return o with { Fills = o.Fills.Take(take).ToList(), OmittedFillCount = o.Fills.Count - take };
        }).ToList();
        return new(bounded, summary.Operations.Count, summary.Facts.Fills.Count,
            summary.Operations.Count - bounded.Count, summary.Coverage, ScopeNote);
    }

    // Overview needs all aggregate results, not the bounded activity display or constituent DTOs.
    internal async Task<ActivitySummaries> ReadSummariesAsync(Guid? accountId, CancellationToken ct, IReadOnlySet<Guid>? accountIds = null)
    {
        if (accountId == Guid.Empty) throw new ProblemException(400, "Choose a valid account.");
        if (accountIds is { Count: 0 }) return new([], [], new([], [], [], new Dictionary<Guid, Guid>()));
        var facts = await store.ReadAsync(accountId, ct, accountIds);
        var accounts = facts.Accounts.Where(a => a.IsEnabled && (accountId == null || a.Id == accountId) &&
            (accountIds == null || accountIds.Contains(a.Id))).ToDictionary(a => a.Id);
        var fills = facts.Fills.Where(f => accounts.ContainsKey(f.AccountId)).ToList();
        var positions = new ActivityPositions(fills, facts.Snapshots);
        var operations = OperationAggregator.AggregateSummaries(fills, facts.FillPlayIds, positions).ToList();
        var lastByContract = new Dictionary<ActivityContractKey, int>();
        for (var i = 0; i < operations.Count; i++)
        {
            var operation = operations[i];
            if (!lastByContract.TryGetValue(operation.ContractKey, out var previous) ||
                operation.LastOccurredAtUtc > operations[previous].LastOccurredAtUtc ||
                operation.LastOccurredAtUtc == operations[previous].LastOccurredAtUtc && operations[previous].OpenQuantity == "0" && operation.OpenQuantity != "0")
                lastByContract[operation.ContractKey] = i;
        }
        var contractsByAccount = positions.Contracts.GroupBy(p => p.Key.AccountId).ToDictionary(g => g.Key, g => g.ToList());
        var coverage = new List<ActivityCoverageDto>();
        foreach (var account in accounts.Values)
        {
            if (account.HistoryNotice is { Length: > 0 } notice) coverage.Add(new(account.Id, null, notice));
            var snapshot = positions.Snapshots.GetValueOrDefault(account.Id);
            if (snapshot is null) coverage.Add(new(account.Id, null, "No latest position snapshot is available for comparison."));
            foreach (var (key, contract) in contractsByAccount.GetValueOrDefault(account.Id) ?? [])
            {
                // Same-time close/open operations use remaining position, not UUID display ordering.
                var hasLast = lastByContract.TryGetValue(key, out var index);
                var last = hasLast ? operations[index] : null;
                var observed = positions.Quantity(key);
                if (snapshot is null && observed is not null) continue;
                string? reason = observed is null ? ActivityPositions.AmbiguousIdentityNotice :
                    last?.LastOccurredAtUtc > snapshot!.ObservedAtUtc ? "Latest snapshot predates retained fills; position comparison is unavailable." :
                    last is not null && last.OpenQuantity is null ? "Computed position is unknown because retained history is incomplete; snapshot comparison is unavailable." : null;
                if (reason is null)
                {
                    var computedText = last?.OpenQuantity ?? "0";
                    // Compare exact strings after normalizing through the aggregator's own signed position.
                    var signed = last?.Direction == "short" && computedText != "0" ? "-" + computedText : computedText;
                    if (observed!.Value.ToString() != signed)
                        reason = $"Latest snapshot position {observed} disagrees with retained-fill position {signed}. Neither is corrected.";
                }
                if (reason is not null)
                {
                    coverage.Add(new(account.Id, contract, reason));
                    if (last is not null && !last.Coverage.Contains(reason))
                    {
                        operations[index] = last with { Coverage = last.Coverage.Append(reason).ToList() };
                    }
                }
            }
        }
        return new(operations, coverage, facts with { Accounts = accounts.Values.ToList(), Fills = fills });
    }
}

internal sealed record ActivitySummaries(IReadOnlyList<ActivityOperationDto> Operations,
    IReadOnlyList<ActivityCoverageDto> Coverage, ActivityFacts Facts);
