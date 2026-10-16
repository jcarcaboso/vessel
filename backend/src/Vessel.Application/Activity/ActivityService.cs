using System.Security.Cryptography;
using System.Text;
using Vessel.Application.Workspace;
using Vessel.Application.Common;

namespace Vessel.Application.Activity;

public sealed class ActivityService(IActivityStore store, IWorkspaceStore workspace, TimeProvider time)
{
    /// <summary>Retrospective preview limit; whole-order attribution beyond it is refused.</summary>
    public const int MaxFillsPerOperation = 200;
    public const int MaxExpandedFills = 1_000, MaxOperationIdLength = 200;
    public const string ScopeNote = "Position round trips from all retained fills on enabled accounts, not trading intent or retrospective Plays. " +
        "Retained history is bounded by venue imports; balanced fills do not prove lifetime coverage. Newest activity first. " +
        "Quantities, sums and flip allocations are exact. Weighted prices round only when necessary to 28 decimal places, halfway away from zero. " +
        NominalStablecoins.Caveat + " Net result subtracts listed stablecoin fees on gross fills; other fee tokens leave it unknown. Net-of-fee P&L is not charged twice. " +
        "Separate funding cashflows are not added, and RISEx reported funding inclusion remains unverified.";

    /// <summary>
    /// Aggregates every retained fill of the scoped enabled accounts, then filters, orders and pages the operations.
    /// Metrics, coverage, facets and the version never depend on the filters or the page.
    /// </summary>
    public async Task<ActivityPageDto> PageAsync(ActivityQuery query, CancellationToken ct)
    {
        var (page, pageSize) = ListPaging.Parse(query.Page, query.PageSize);
        var scope = ListScope.Parse(query.Scope);
        if (query.AccountId == Guid.Empty) throw new ProblemException(400, "Choose a valid account.");
        var asOf = time.GetUtcNow();
        var filter = ActivityFilter.Parse(query, asOf);
        var accounts = await workspace.AccountsAsync(ct);
        var portfolios = scope.Kind == "portfolio" ? await workspace.PortfoliosAsync(ct) : [];
        scope.RequireKnown(id => portfolios.Any(p => p.Id == id), id => accounts.Any(a => a.Id == id));
        if (query.AccountId is { } detail && !accounts.Any(a => a.Id == detail)) throw new ProblemException(404, "Account not found.");
        var members = accounts.Where(a => scope.Includes(a.Id, a.PortfolioId, a.IsEnabled) && (query.AccountId is null || a.Id == query.AccountId))
            .Select(a => a.Id).ToHashSet();
        var summary = await ReadSummariesAsync(null, ct, members);
        var portfolioOf = summary.Facts.Accounts.ToDictionary(a => a.Id, a => a.PortfolioId);
        var scoped = summary.Operations.OrderByDescending(o => o.LastOccurredAtUtc)
            .ThenBy(o => o.AccountId.ToString("D"), StringComparer.Ordinal).ThenBy(o => o.Id, StringComparer.Ordinal).ToList();
        var filtered = scoped.Where(o => filter.Matches(o, portfolioOf.GetValueOrDefault(o.AccountId))).ToList();
        page = ListPaging.Clamp(page, pageSize, filtered.Count);
        return new(filtered.Skip(ListPaging.Skip(page, pageSize)).Take(pageSize).Select(ActivityOperationSummaryDto.From).ToList(),
            page, pageSize, filtered.Count, scoped.Count, summary.Facts.Fills.Count, asOf, Version(scoped),
            new(scoped.Select(o => o.AccountId).Distinct().OrderBy(id => id.ToString("D"), StringComparer.Ordinal).ToList(),
                scoped.Select(o => o.ContractId).Distinct().Order(StringComparer.Ordinal).ToList()),
            summary.Coverage, ScopeNote);
    }

    /// <summary>One operation's constituent rows, re-aggregated from that account only. Changed history is 404.</summary>
    public async Task<OperationFillsDto> FillsAsync(Guid? accountId, string? operationId, CancellationToken ct)
    {
        if (accountId is null || accountId == Guid.Empty || string.IsNullOrWhiteSpace(operationId) || operationId.Length > MaxOperationIdLength)
            throw new ProblemException(400, "Choose a valid account and retained operation.");
        // Missing and foreign accounts are 404 in the store; a disabled account has no visible operations.
        var summary = await ReadSummariesAsync(accountId, ct);
        var operation = summary.Operations.SingleOrDefault(o => o.Id == operationId)
            ?? throw new ProblemException(404, "Retained operation not found. Reload Activity.");
        var shown = operation.Fills.Take(MaxExpandedFills).ToList();
        return new(operation.Id, shown, operation.Fills.Count - shown.Count);
    }

    // Changes when any scoped operation's identity, fill count, last execution, open quantity or Play association changes.
    private static string Version(IEnumerable<ActivityOperationDto> operations)
    {
        var text = new StringBuilder();
        foreach (var o in operations)
            text.Append(o.AccountId.ToString("N")).Append('|').Append(o.Id).Append('|').Append(o.FillCount).Append('|')
                .Append(o.LastOccurredAtUtc.UtcTicks).Append('|').Append(o.OpenQuantity ?? "?").Append('|')
                .Append(o.PlayAssociation).Append('|').Append(o.PlayId?.ToString("N")).Append('\n');
        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(text.ToString())), 0, 16);
    }

    // Overview, Activity pages and the fills endpoint share these unbounded aggregate results; constituent DTOs
    // are only built for the rows a caller returns.
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
