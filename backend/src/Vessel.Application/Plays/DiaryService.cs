using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Vessel.Application.Activity;
using Vessel.Application.Plays.Execution;
using Vessel.Application.Venues;
using Vessel.Application.Workspace;
using Vessel.Domain.Plays;
using Vessel.Domain.Workspace;

namespace Vessel.Application.Plays;

public sealed class DiaryService(IPlayStore plays, IDiaryStore diary, IPlayExecutionStore executions,
    IVenueRegistry venues, TimeProvider time)
{
    public const int MaxManualRecords = 200, MaxManualHistory = 1000;
    public const int MaxReasons = 100;
    public const string ManualNotice = "Owner-entered manual facts and chronological average-cost USD estimates only. " +
        "Linear USD-quoted contracts only, one base unit per recorded quantity; inverse contracts, other quotes and implicit multipliers are unsupported. " +
        "Not venue imports, Activity operations or reported account balances. Unknown costs are not zero. " +
        "Execution times must use whole microseconds; finer precision is rejected, never rounded. " +
        "Partial average-cost allocations use decimal precision; the final close takes all remaining cost. " +
        "Net results subtract known USDC execution fees; funding and slippage are not added. " +
        "At most 200 records and 1000 history revisions per Play; further writes are rejected, never silently omitted.";
    public const string RetrospectiveNotice = "Owner-confirmed completed imported operation, not a contemporaneous thesis or plan. " +
        "Whole-order associations only. No inferred leverage or initial-risk R; excluded from the sizing ladder. " +
        "Return is net result divided by executed entry notional, not return on margin. Retained history may be incomplete.";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public Task<ManualExecutionsDto> ManualAsync(Guid playId, CancellationToken ct) =>
        plays.WithPlayLockAsync(playId, async () =>
        {
            var play = await RequireManual(playId, ct);
            return await ManualResult(play, await diary.ManualAsync(playId, ct), ct);
        }, ct);

    public Task<ManualExecutionsDto> RecordAsync(Guid playId, Guid? executionId, ManualExecutionRequest request, CancellationToken ct) =>
        Idempotent(request.RequestId, new { playId, executionId, request }, async () =>
            await plays.WithPlayLockAsync(playId, async () =>
            {
                var play = await RequireManual(playId, ct);
                if (play.Version != request.ExpectedVersion) throw new WorkspaceException(409, "This Play changed. Reload before recording facts.");
                if (executionId is null ? play.Status is not (PlayStatus.Planned or PlayStatus.Open) :
                    play.Status is not (PlayStatus.Open or PlayStatus.Closed))
                    throw new WorkspaceException(409, "Record facts on Planned/Open Plays; corrections require Open/Closed Plays.");
                var rows = await diary.ManualAsync(playId, ct);
                if (executionId is null && rows.Count >= MaxManualRecords ||
                    (await diary.ManualHistoryAsync(playId, ct)).Count >= MaxManualHistory)
                    throw new WorkspaceException(409, "This manual ledger reached its explicit record/history limit.");
                var previous = executionId is { } id ? rows.SingleOrDefault(r => r.Id == id)
                    ?? throw new WorkspaceException(404, "Manual execution not found.") : null;
                var before = previous is null ? null : Dto(previous);
                Validate(request, play, executionId is not null);
                if (previous is not null && (previous.Role != request.Role || previous.EntryId != request.EntryId || previous.Side != request.Side))
                    throw new WorkspaceException(409, "A correction keeps execution role, entry and side.");
                if (play.Status == PlayStatus.Closed && previous?.Source != request.Source)
                    throw new WorkspaceException(409, "Closed corrections keep the source label; correct amounts, prices, costs or times.");
                var now = time.GetUtcNow();
                var row = new ManualExecution
                {
                    Id = previous?.Id ?? Guid.NewGuid(), OwnerId = play.OwnerId, PlayId = play.Id,
                    Role = request.Role, EntryId = request.EntryId, OccurredAtUtc = request.OccurredAtUtc,
                    Side = request.Side, Quantity = request.Quantity, Price = request.Price, Fee = request.Fee,
                    FeeCurrency = request.FeeCurrency, Source = request.Source,
                    CreatedAtUtc = previous?.CreatedAtUtc ?? now, UpdatedAtUtc = now
                };
                var resulting = rows.Where(r => r.Id != row.Id).Append(row).ToList();
                var ledger = ManualLedger.Calculate(play, resulting);
                if (play.Status == PlayStatus.Closed && ledger.ClosedAt is null)
                    throw new WorkspaceException(409, "A correction cannot reopen a Closed Play.");
                if (previous is null) diary.Add(row);
                else
                {
                    previous.OccurredAtUtc = row.OccurredAtUtc; previous.Quantity = row.Quantity; previous.Price = row.Price;
                    previous.Fee = row.Fee; previous.FeeCurrency = row.FeeCurrency; previous.Source = row.Source; previous.UpdatedAtUtc = now;
                }
                diary.Add(new ManualExecutionHistory
                {
                    Id = Guid.NewGuid(), OwnerId = play.OwnerId, PlayId = play.Id, ExecutionId = row.Id,
                    Reason = previous is null ? null : request.Reason!.Trim(), OccurredAtUtc = now,
                    Before = before is null ? null : JsonSerializer.Serialize(before, Json), After = JsonSerializer.Serialize(Dto(row), Json)
                });
                if (play.Status == PlayStatus.Planned && ledger.Entered > 0) plays.Add(play.RecordManualOpen(now));
                if (play.Status == PlayStatus.Open && ledger.ClosedAt is { } closedAt) plays.Add(play.RecordManualClose(closedAt, now));
                else play.RecordManualCorrection(ledger.ClosedAt, now);
                await plays.SaveAsync(ct);
                return await ManualResult(play, resulting, ct);
            }, ct), ct);

    private async Task<Play> RequireManual(Guid id, CancellationToken ct)
    {
        var play = await plays.FindAsync(id, ct) ?? throw new WorkspaceException(404, "Play not found.");
        var account = await plays.AccountAsync(play.AccountId, ct) ?? throw new WorkspaceException(404, "Account not found.");
        if (!account.IsEnabled) throw new WorkspaceException(409, "Enable the account before using manual execution facts.");
        if (venues.Descriptor(account.VenueId)?.Capabilities.ManualExecutions != true || play.Origin != PlayOrigin.Planned)
            throw new WorkspaceException(409, "This account does not support owner-entered manual execution facts.");
        return play;
    }

    private void Validate(ManualExecutionRequest request, Play play, bool correction)
    {
        var plan = PlayDocuments.Read(play.Plan);
        if (request.Role is not ("entry" or "exit") || request.Side is not (ExecutionFacts.Buy or ExecutionFacts.Sell) ||
            request.Role == "entry" && !plan.Entries.Any(e => e.Id == request.EntryId) ||
            request.Role == "exit" && request.EntryId is not null)
            throw new WorkspaceException(400, "Choose entry with a saved entry ID, or exit without an entry ID, and normalized buy/sell.");
        if (request.OccurredAtUtc.Offset != TimeSpan.Zero || request.OccurredAtUtc > time.GetUtcNow() ||
            request.OccurredAtUtc == default)
            throw new WorkspaceException(400, "Execution time must be a nonfuture UTC timestamp.");
        if (request.OccurredAtUtc.Ticks % TimeSpan.TicksPerMicrosecond != 0)
            throw new WorkspaceException(400, "Execution time must use whole microseconds; finer precision is not supported.");
        ManualLedger.Number(request.Quantity, true); ManualLedger.Number(request.Price, true);
        if ((request.Fee is null) != (request.FeeCurrency is null) ||
            request.FeeCurrency is { } currency && (currency.Length is < 1 or > 32 || currency != currency.Trim() ||
                currency.Any(c => !char.IsAsciiLetterOrDigit(c) && c is not ('-' or '_'))))
            throw new WorkspaceException(400, "Supply both fee and currency, or leave both null for unknown costs.");
        if (request.Fee is not null) ManualLedger.Number(request.Fee, false);
        if (request.Source is null || request.Source.Length is < 1 or > 100 || request.Source != request.Source.Trim() ||
            request.Source.Any(char.IsControl))
            throw new WorkspaceException(400, "Source must be a short plain label, up to 100 characters.");
        if (correction && (string.IsNullOrWhiteSpace(request.Reason) || request.Reason.Length > 2000 || request.Reason.Any(char.IsControl)))
            throw new WorkspaceException(400, "A correction requires a plain reason, up to 2000 characters.");
    }

    private async Task<ManualExecutionsDto> ManualResult(Play play, IReadOnlyList<ManualExecution> rows, CancellationToken ct)
    {
        var ledger = ManualLedger.Calculate(play, rows);
        var history = await diary.ManualHistoryAsync(play.Id, ct);
        if (rows.Count > MaxManualRecords || history.Count > MaxManualHistory)
            throw new WorkspaceException(409, "Stored ledger exceeds its explicit response limits.");
        return new(PlayService.ToDto(play), rows.OrderBy(r => r.OccurredAtUtc).ThenBy(r => r.Id).Select(Dto).ToList(),
            history.Select(h => new ManualHistoryDto(h.Id, h.ExecutionId, h.Reason, h.OccurredAtUtc,
                h.Before is null ? null : JsonSerializer.Deserialize<ManualExecutionDto>(h.Before, Json),
                JsonSerializer.Deserialize<ManualExecutionDto>(h.After, Json)!)).ToList(),
            new(ManualLedger.Text(ledger.Entered), ManualLedger.Text(ledger.Exited), ManualLedger.Text(ledger.Open),
                ManualLedger.Text(ledger.Gross), ledger.Net is { } net ? ManualLedger.Text(net) : null, ledger.FeesComplete), ManualNotice);
    }
    private static ManualExecutionDto Dto(ManualExecution row) => new(row.Id, row.Role, row.EntryId, row.OccurredAtUtc,
        row.Side, row.Quantity, row.Price, row.Fee, row.FeeCurrency, row.Source, row.CreatedAtUtc, row.UpdatedAtUtc);

    public Task<RetrospectivePreviewDto> PreviewAsync(Guid accountId, string operationId, CancellationToken ct) =>
        executions.WithAccountLockAsync(accountId, () => PreviewLocked(accountId, operationId, ct), ct);

    private async Task<RetrospectivePreviewDto> PreviewLocked(Guid accountId, string operationId, CancellationToken ct)
    {
        if (accountId == Guid.Empty || string.IsNullOrWhiteSpace(operationId) || operationId.Length > 200)
            throw new WorkspaceException(400, "Choose a valid account and retained operation.");
        var account = await plays.AccountAsync(accountId, ct) ?? throw new WorkspaceException(404, "Account not found.");
        if (!account.IsEnabled) throw new WorkspaceException(409, "Enable the account before reviewing imported operations.");
        var facts = await diary.ActivityAsync(accountId, ct);
        var operation = OperationAggregator.Aggregate(facts.Fills, facts.FillPlayIds, facts.Snapshots).SingleOrDefault(o => o.Id == operationId)
            ?? throw new WorkspaceException(404, "Retained operation not found. Reload Activity.");
        var orders = await diary.OrdersAsync(accountId, ct);
        var links = await diary.LinksAsync(accountId, ct);
        var ids = operation.Fills.Select(f => f.Fill.Id).ToHashSet();
        var own = facts.Fills.Where(f => ids.Contains(f.Id)).ToList();
        var orderIds = own.Select(f => f.OrderId).ToHashSet(StringComparer.Ordinal);
        List<string> reasons = [];
        if (operation.Status != "closed" || operation.Direction is not ("long" or "short"))
            reasons.Add("Only a completed single-direction operation can become a retrospective Play.");
        if (operation.PlayAssociation != "unassigned" || links.Any(l => orderIds.Contains(l.OrderId) && l.State == OrderLinkState.Linked))
            reasons.Add("This operation contains existing or mixed Play associations.");
        reasons.AddRange(operation.Coverage.Where(r => !r.StartsWith("Net result is unknown:", StringComparison.Ordinal)));
        if (operation.Fills.Count > ActivityService.MaxFillsPerOperation || operation.OmittedFillCount > 0 ||
            operation.FillCount != own.Count || operation.Fills.Any(f => f.Quantity != ManualLedger.Text(own.Single(x => x.Id == f.Fill.Id).Quantity)))
            reasons.Add("Constituent rows are omitted or split/flip allocations; whole-order attribution is unsafe.");
        if (own.Any(f => f.PositionEffect is not (ExecutionFacts.Open or ExecutionFacts.Close)))
            reasons.Add("Some fills have unknown or flip position effects.");
        if (own.Any(f => f.Quantity <= 0 || f.Price <= 0 || f.OccurredAtUtc > time.GetUtcNow()))
            reasons.Add("Some retained fills have nonpositive amounts/prices or future timestamps.");
        foreach (var orderId in orderIds.Order(StringComparer.Ordinal))
        {
            var fills = facts.Fills.Where(f => f.OrderId == orderId).ToList();
            var order = orders.SingleOrDefault(o => o.OrderId == orderId);
            if (string.IsNullOrWhiteSpace(orderId) || order is null)
                reasons.Add($"Order {orderId} has no retained order record; execution completeness cannot be checked.");
            else if (ExecutionIntegrity.MissingExecutions(order, fills.Sum(f => f.Quantity)))
                reasons.Add($"Order {orderId} is known to have missing executions.");
            else if (order.Status is "open" or "triggered")
                reasons.Add($"Order {orderId} can still execute.");
            if (fills.Any(f => !ids.Contains(f.Id)) || fills.Select(f => f.PositionEffect).Distinct().Count() != 1)
                reasons.Add($"Order {orderId} crosses operation boundaries or requires different roles.");
            if (order is not null && (order.ContractId != operation.ContractId ||
                fills.Any(f => f.AccountId != account.Id || f.OwnerId != account.OwnerId || f.ContractId != operation.ContractId ||
                    order.VenueContractId is not null && f.VenueContractId is not null && order.VenueContractId != f.VenueContractId) ||
                order.Side != fills.FirstOrDefault()?.Side || order.ReduceOnly && fills.Any(f => f.PositionEffect == ExecutionFacts.Open)))
                reasons.Add($"Order {orderId} identity or role contradicts its executions.");
        }
        var fingerprint = Hash(new { account.Id, account.OwnerId, account.IsEnabled, account.SettingsRevision, operation,
            fills = facts.Fills.OrderBy(f => f.Id), orders = orders.Where(o => orderIds.Contains(o.OrderId)).OrderBy(o => o.OrderId),
            links = links.Where(l => orderIds.Contains(l.OrderId)).OrderBy(l => l.Id) });
        var bounded = operation with { Fills = operation.Fills.Take(ActivityService.MaxFillsPerOperation).ToList(),
            OmittedFillCount = Math.Max(0, operation.Fills.Count - ActivityService.MaxFillsPerOperation) };
        return new(reasons.Count == 0, BoundedReasons(reasons), fingerprint, bounded, RetrospectiveNotice);
    }

    public Task<PlayDto> CreateRetrospectiveAsync(CreateRetrospectiveRequest request, CancellationToken ct) =>
        Idempotent(request.RequestId, request, () => executions.WithAccountLockAsync(request.AccountId, async () =>
        {
            var preview = await PreviewLocked(request.AccountId, request.OperationId, ct);
            if (preview.Fingerprint != request.ExpectedFingerprint)
                throw new WorkspaceException(409, "The retained operation changed since preview. Reload and review it again.");
            if (!preview.Eligible) throw new WorkspaceException(409, string.Join(" ", preview.Reasons));
            var account = (await plays.AccountAsync(request.AccountId, ct))!;
            if (request.Title is null || request.Title.Trim().Length > Play.MaxTitleLength ||
                request.Review?.Length > Play.MaxReviewLength)
                throw new WorkspaceException(400, "Retrospective title or review exceeds its text limit.");
            var now = time.GetUtcNow();
            var emptyPlan = new PlayPlanDocument(preview.Operation.Direction!, "margin", "", "0", null, [],
                new PlanNotes("", "", "", ""));
            var play = Play.Retrospective(Guid.NewGuid(), account, new(account.VenueId, preview.Operation.ContractId),
                PlayDocuments.Serialize(emptyPlan), preview.Operation.ClosedAtUtc!.Value, now, request.Title);
            var review = play.Annotate(request.Title ?? "", "{}", request.Review ?? "", now);
            plays.Add(play);
            if (review is not null) plays.Add(review);
            foreach (var order in preview.Operation.Fills.GroupBy(f => f.Fill.OrderId))
                diary.Add(new PlayOrderLink(play, order.Key, order.First().Role == "entry" ? OrderLinkRole.Entry : OrderLinkRole.Exit,
                    order.First().Role == "entry" ? "retrospective" : null, null, OrderLinkState.Linked, OrderLinkSource.Owner, now));
            await plays.SaveAsync(ct);
            return PlayService.ToDto(play);
        }, ct), ct);

    private Task<T> Idempotent<T>(Guid requestId, object payload, Func<Task<T>> action, CancellationToken ct) =>
        diary.WithRequestLockAsync(requestId, async () =>
        {
            if (requestId == Guid.Empty) throw new WorkspaceException(400, "A nonempty requestId is required.");
            var hash = Hash(payload);
            if (await diary.RequestAsync(requestId, ct) is { } existing)
            {
                if (existing.PayloadHash != hash) throw new WorkspaceException(409, "This requestId was already used with a different payload.");
                var cached = JsonSerializer.Deserialize<T>(existing.Response, Json)!;
                var accountId = cached switch { ManualExecutionsDto m => m.Play.Summary.AccountId, PlayDto p => p.Summary.AccountId,
                    _ => throw new InvalidOperationException() };
                return await executions.WithAccountLockAsync(accountId, async () =>
                {
                    var account = await plays.AccountAsync(accountId, ct) ?? throw new WorkspaceException(404, "Account not found.");
                    if (!account.IsEnabled) throw new WorkspaceException(409, "Enable the account before accessing diary execution facts.");
                    return cached;
                }, ct);
            }
            var result = await action();
            var ownerId = result switch { ManualExecutionsDto m => (await plays.FindAsync(m.Play.Summary.Id, ct))!.OwnerId,
                PlayDto p => (await plays.FindAsync(p.Summary.Id, ct))!.OwnerId, _ => throw new InvalidOperationException() };
            diary.Add(new DiaryRequest { Id = requestId, OwnerId = ownerId, PayloadHash = hash, Response = JsonSerializer.Serialize(result, Json) });
            await plays.SaveAsync(ct);
            return result;
        }, ct);

    private static string Hash(object payload) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload, Json))));

    public static IReadOnlyList<string> BoundedReasons(IEnumerable<string> reasons)
    {
        var all = reasons.Distinct().ToList();
        return all.Count <= MaxReasons ? all : all.Take(MaxReasons - 1)
            .Append($"{all.Count - MaxReasons + 1} additional reasons omitted from this response; this record is still excluded/ineligible.").ToList();
    }
}
