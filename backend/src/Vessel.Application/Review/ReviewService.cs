using System.Globalization;
using Vessel.Application.Plays;
using Vessel.Application.Plays.Execution;
using Vessel.Application.Sizing;
using Vessel.Application.Workspace;
using Vessel.Domain.Plays;
using Vessel.Domain.Sizing;
using Vessel.Domain.Workspace;

namespace Vessel.Application.Review;

/// <summary>Read-only reporting. Never assigns fills, mutates lifecycle or refreshes a venue.</summary>
public sealed class ReviewService(IReviewStore store, TimeProvider time)
{
    public const int PageSize = 50;
    public static readonly string[] Periods = ["day", "week", "month", "year", "all"];
    private const string Notice = "Saved closed Plays only, from their linked executions. Unassigned imported fills are not Plays. " +
        "Retrospective imported-Play grouping is not implemented. Retained venue history can be incomplete; All is not lifetime history. " +
        "Results are nominal USD and include reported execution fees once. Separate funding cashflows are not added; " +
        "whether RISEx reported realized P&L includes funding remains unverified. Balanced retained fills are not proof of full venue history. " +
        "Accounts use current portfolio membership; disabled accounts are excluded. Open-play counts are current, not a historical cohort.";

    public static DateTimeOffset? From(string period, DateTimeOffset now) => period switch
    {
        "day" => now.AddDays(-1), "week" => now.AddDays(-7), "month" => now.AddDays(-30),
        "year" => now.AddDays(-365), "all" => null,
        _ => throw new WorkspaceException(400, "Choose day, week, month, year or all."),
    };

    public async Task<ReviewDto> GetAsync(ReviewQuery query, CancellationToken ct)
    {
        var now = time.GetUtcNow();
        var from = From(query.Period, now);
        if (query.Portfolio is not ("all" or "unassigned") &&
            (!Guid.TryParse(query.Portfolio, out var portfolio) || portfolio == Guid.Empty))
            throw new WorkspaceException(400, "Choose a valid portfolio.");
        if (Guid.TryParse(query.Portfolio, out var normalized)) query = query with { Portfolio = normalized.ToString() };
        if (query.AccountId == Guid.Empty || query.Offset is < 0 or > 1_000_000 ||
            query.Instrument is { } instrument && (string.IsNullOrWhiteSpace(instrument) || instrument.Length > 128 || instrument != instrument.Trim()))
            throw new WorkspaceException(400, "Invalid review filters.");

        var facts = await store.ReadAsync(query, now, ct);
        var accounts = facts.Accounts.Where(a => a.IsEnabled).ToDictionary(a => a.Id);
        var scoped = accounts.Values.Where(a =>
            (query.AccountId is null || a.Id == query.AccountId) &&
            (query.Portfolio == "all" || query.Portfolio == "unassigned" && a.PortfolioId is null ||
                a.PortfolioId?.ToString() == query.Portfolio)).Select(a => a.Id).ToHashSet();
        var evaluated = facts.ClosedPlays.Where(f => scoped.Contains(f.Play.AccountId) &&
            (query.Instrument is null || f.Play.ContractId == query.Instrument))
            .Select(f => Evaluate(f, now, facts.IncompleteOrderPlayIds?.Contains(f.Play.Id) == true)).ToList();
        var accepted = evaluated.Where(e => e.Result is not null)
            .OrderBy(e => e.ClosedAt).ThenBy(e => e.Facts.Play.Id).ToList();
        var current = accepted.Where(e => InPeriod(e.ClosedAt, from, now)).ToList();
        var candidates = evaluated.Where(e => InPeriod(e.ClosedAt, from, now)).ToList();
        var portfolioNames = facts.Portfolios.ToDictionary(p => p.Id.ToString(), p => p.Name);
        var options = new ReviewOptionsDto(
            facts.Portfolios.OrderBy(p => p.Name).Select(p => new ReviewPortfolioDto(p.Id.ToString(), p.Name)).ToList(),
            accounts.Values.OrderBy(a => a.Name).Select(a => new ReviewAccountDto(a.Id, a.Name, a.PortfolioId, a.VenueId,
                a.LastSyncedAtUtc, a.SyncStatus, a.HistoryNotice)).ToList(),
            facts.ClosedPlays.Where(f => accounts.ContainsKey(f.Play.AccountId)).Select(f => f.Play.ContractId)
                .OfType<string>().Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToList());
        var series = Series(current, from, now);
        List<ReviewGroupDto> Groups(Func<Evaluated, string> key, Func<string, string> name, Func<string, List<Evaluated>, string> detail) =>
            current.GroupBy(key).Select(group =>
            {
                var items = group.ToList();
                return (Total: items.Sum(x => x.Result!.NetResult),
                    Dto: new ReviewGroupDto(group.Key, name(group.Key), detail(group.Key, items), Metrics(items)));
            }).OrderByDescending(x => x.Total).ThenBy(x => x.Dto.Name, StringComparer.Ordinal).Select(x => x.Dto).ToList();

        var groups = new ReviewGroupsDto(
            Groups(e => accounts[e.Facts.Play.AccountId].PortfolioId?.ToString() ?? "unassigned",
                id => portfolioNames.GetValueOrDefault(id) ?? "Unassigned", (_, items) =>
                {
                    var count = items.Select(x => x.Facts.Play.AccountId).Distinct().Count();
                    return $"{count} account{(count == 1 ? "" : "s")}";
                }),
            Groups(e => e.Facts.Play.AccountId.ToString(), id => accounts[Guid.Parse(id)].Name,
                (id, _) => accounts[Guid.Parse(id)].VenueId),
            Groups(e => e.Facts.Play.ContractId!, id => id, (_, items) =>
                string.Join(", ", items.Select(e => e.Facts.Play.VenueId).Distinct().Order())));
        var page = current.OrderByDescending(e => e.ClosedAt).ThenBy(e => e.Facts.Play.Id).Skip(query.Offset).Take(PageSize)
            .Select(e => new ReviewPlayDto(e.Facts.Play.Id, e.Facts.Play.Title, e.Facts.Play.AccountId,
                accounts[e.Facts.Play.AccountId].Name, e.Facts.Play.VenueId, e.Facts.Play.ContractId!, e.ClosedAt,
                Number(e.Result!.NetResult), Number(e.Result.ReturnPercent), Number(e.Result.RMultiple),
                !string.IsNullOrWhiteSpace(e.Facts.Play.Review))).ToList();
        return new ReviewDto(now, from ?? current.FirstOrDefault()?.ClosedAt, query.Period, "USD",
            options, Periods.Select(period => {
                var selected = accepted.Where(e => InPeriod(e.ClosedAt, From(period, now), now)).ToList();
                return new ReviewPeriodDto(period, selected.Count, selected.Count == 0 ? null : Number(selected.Sum(e => e.Result!.NetResult)));
            }).ToList(),
            Metrics(current), series.Points, series.BucketDays, groups,
            new ReviewCoverageDto(candidates.Count, candidates.Count(e => e.Exclusion == "fees"),
                candidates.Count(e => e.Exclusion == "executions"), facts.OpenPlays, facts.UnassignedFills, facts.FirstFillAtUtc, Notice),
            page, query.Offset, query.Offset + page.Count < current.Count ? query.Offset + page.Count : null);
    }

    private sealed record Evaluated(ClosedPlayFacts Facts, DateTimeOffset ClosedAt, PlayOutcome? Result, string? Exclusion);

    private static Evaluated Evaluate(ClosedPlayFacts facts, DateTimeOffset now, bool incompleteOrders)
    {
        var fills = facts.Fills;
        var entries = fills.Where(f => f.Role == OrderLinkRole.Entry).ToList();
        var exits = fills.Where(f => f.Role != OrderLinkRole.Entry).ToList();
        // EndedAtUtc records when sync detected closure, not necessarily when it happened.
        var close = exits.Count > 0 ? exits.Max(f => f.Fill.OccurredAtUtc) : facts.Play.EndedAtUtc ?? facts.Play.UpdatedAtUtc;
        var incomplete = new Evaluated(facts, close, null, "executions");
        if (incompleteOrders || facts.Play.Status != PlayStatus.Closed || facts.Play.ContractId is null || entries.Count == 0 || exits.Count == 0 ||
            fills.Select(f => f.Fill.Id).Distinct().Count() != fills.Count ||
            fills.Any(f => f.Fill.AccountId != facts.Play.AccountId || f.Fill.ContractId != facts.Play.ContractId ||
                f.Fill.OccurredAtUtc > now || f.Fill.Quantity <= 0 || f.Fill.Price <= 0) ||
            entries.Any(f => f.Fill.PositionEffect != ExecutionFacts.Open) ||
            exits.Any(f => f.Fill.PositionEffect != ExecutionFacts.Close) ||
            entries.Sum(f => f.Fill.Quantity) != exits.Sum(f => f.Fill.Quantity))
            return incomplete;
        // A flip, mismatched side or missing opening quantity cannot establish a complete Play outcome.
        var side = entries[0].Fill.Side;
        if (side is not (ExecutionFacts.Buy or ExecutionFacts.Sell) || entries.Any(f => f.Fill.Side != side) ||
            exits.Any(f => f.Fill.Side != (side == ExecutionFacts.Buy ? ExecutionFacts.Sell : ExecutionFacts.Buy)))
            return incomplete;
        decimal balance = 0;
        foreach (var group in fills.GroupBy(f => f.Fill.OccurredAtUtc).OrderBy(g => g.Key))
        {
            balance += group.Sum(f => f.Role == OrderLinkRole.Entry ? f.Fill.Quantity : -f.Fill.Quantity);
            if (balance < 0) return incomplete;
        }
        var result = PlayOutcomeCalculator.Outcome(facts);
        if (result is not null && !HasCompleteInitialRisk(facts, entries.Min(f => f.Fill.OccurredAtUtc), side))
            result = result with { PlannedRisk = null };
        return result is null ? incomplete : !result.FeesComplete ? incomplete with { Exclusion = "fees" }
            : new Evaluated(facts, close, result, null);
    }

    private static bool HasCompleteInitialRisk(ClosedPlayFacts facts, DateTimeOffset entryAt, string side)
    {
        // Review never treats a retrospective or partially specified plan as known initial risk.
        // The sizing assistant retains its existing fallback/partial-plan estimate.
        var revision = facts.Revisions.Where(r => r.CreatedAtUtc <= entryAt).OrderBy(r => r.Number).LastOrDefault();
        if (revision is null) return false;
        var plan = PlayDocuments.Read(revision.Plan);
        if ((plan.Direction == "long" ? ExecutionFacts.Buy : ExecutionFacts.Sell) != side) return false;
        static decimal Positive(string value) =>
            decimal.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var number) && number > 0 ? number : 0;
        if (plan.Entries.Count == 0 || plan.Entries.Sum(e => Positive(e.Share)) != 100) return false;
        var levels = ExecutionMatcher.Levels(plan).Where(l => l.Role == OrderLinkRole.Stop).ToLookup(l => l.EntryId);
        return plan.Entries.All(e => Positive(e.Share) > 0 && Positive(e.Price) > 0 && e.Stops.Count > 0 &&
            e.Stops.Sum(s => Positive(s.Share)) == 100 && e.Stops.All(s => Positive(s.Share) > 0 &&
                levels[e.Id].FirstOrDefault(l => l.LevelId == s.Id)?.Price is > 0 and var stop &&
                (plan.Direction == "long" ? stop < Positive(e.Price) : stop > Positive(e.Price))));
    }

    private static bool InPeriod(DateTimeOffset at, DateTimeOffset? from, DateTimeOffset now) =>
        at <= now && (from is null || at > from);

    private static ReviewMetricsDto Metrics(List<Evaluated> plays)
    {
        var outcomes = plays.Select(p => p.Result!).ToList();
        var wins = outcomes.Where(o => o.NetResult > 0).ToList();
        var losses = outcomes.Where(o => o.NetResult < 0).ToList();
        var gain = Average(wins.Select(o => o.ReturnPercent));
        var loss = Average(losses.Select(o => -o.ReturnPercent));
        var risks = outcomes.Where(o => o.RMultiple is not null).ToList();
        decimal running = 0, peak = 0, drawdown = 0;
        int streak = 0, maxWins = 0, maxLosses = 0;
        foreach (var play in plays.OrderBy(e => e.ClosedAt).ThenBy(e => e.Facts.Play.Id))
        {
            var net = play.Result!.NetResult;
            running += net;
            peak = Math.Max(peak, running);
            drawdown = Math.Max(drawdown, peak - running);
            if (net == 0) continue;
            streak = net > 0 ? Math.Max(0, streak) + 1 : Math.Min(0, streak) - 1;
            maxWins = Math.Max(maxWins, streak);
            maxLosses = Math.Max(maxLosses, -streak);
        }
        return new(plays.Count, wins.Count, losses.Count, plays.Count - wins.Count - losses.Count,
            plays.Count == 0 ? null : Number(running), Number(Ratio(wins.Count, wins.Count + losses.Count)),
            Number(gain), Number(loss), Number(Ratio(gain, loss)), Number(Ratio(wins.Sum(o => o.NetResult), -losses.Sum(o => o.NetResult))),
            Number(Average(wins.Select(o => o.NetResult))), Number(Average(losses.Select(o => -o.NetResult))),
            Number(Ratio(running, plays.Count)), Number(Average(risks.Select(o => o.RMultiple!.Value))), risks.Count,
            plays.Count(p => !string.IsNullOrWhiteSpace(p.Facts.Play.Review)), plays.Count == 0 ? null : Number(drawdown),
            maxWins, maxLosses);
    }

    private static (List<ReviewPointDto> Points, int BucketDays) Series(List<Evaluated> plays, DateTimeOffset? from, DateTimeOffset now)
    {
        if (plays.Count == 0) return ([], 1);
        var first = (from ?? plays.Min(p => p.ClosedAt)).UtcDateTime.Date;
        // Bound long-history charts without truncating any outcomes or aggregates.
        var days = (now.UtcDateTime.Date - first).Days + 1;
        var bucketDays = Math.Max(1, (int)Math.Ceiling(days / 366m));
        var buckets = plays.ToLookup(p => (p.ClosedAt.UtcDateTime.Date - first).Days / bucketDays);
        List<ReviewPointDto> points = [];
        decimal cumulative = 0, peak = 0;
        for (var index = 0; index * bucketDays < days; index++)
        {
            var items = buckets[index].ToList();
            var net = items.Sum(p => p.Result!.NetResult);
            cumulative += net;
            peak = Math.Max(peak, cumulative);
            var end = first.AddDays(Math.Min((index + 1) * bucketDays, days) - 1);
            points.Add(new(new DateTimeOffset(end, TimeSpan.Zero), Number(net), Number(cumulative), Number(cumulative - peak), items.Count));
        }
        return (points, bucketDays);
    }

    private static decimal? Average(IEnumerable<decimal> values)
    {
        var items = values.ToList();
        return items.Count == 0 ? null : items.Average();
    }
    private static decimal? Ratio(decimal? a, decimal? b) => a is not null && b > 0 ? a / b : null;
    private static string Number(decimal value) => value.ToString("0.############################", CultureInfo.InvariantCulture);
    private static string? Number(decimal? value) => value is { } number ? Number(number) : null;
}
