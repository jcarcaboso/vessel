using System.Text.RegularExpressions;
using System.Text.Json;
using Vessel.Application.Common;
using Vessel.Application.Evidence;
using Vessel.Domain.Accounts;
using Vessel.Domain.Markets;
using Vessel.Domain.Plays;

namespace Vessel.Application.Plays;

/// <summary>
/// Saved Plays and their lifecycle. Open and Closed come from linked venue fills, so this service
/// only performs the owner's transitions: plan, pause, resume and cancel. Nothing is sent to a venue.
/// </summary>
public sealed partial class PlayService(IPlayStore store, IEvidenceObjectStore objects, TimeProvider time)
{
    public async Task<IReadOnlyList<PlaySummaryDto>> ListAsync(CancellationToken ct) =>
        (await store.ListAsync(ct)).Select(Summary).ToList();

    public async Task<PlayDto> GetAsync(Guid id, CancellationToken ct) => ToDto(await Find(id, ct));

    public async Task<PlayDto> CreateAsync(CreatePlayRequest request, CancellationToken ct)
    {
        var account = await EnabledAccount(request.AccountId, ct);
        var (instrument, source) = Instrument(account, request.Instrument, request.InstrumentSource);
        var plan = PlayDocuments.Serialize(PlayDocuments.Normalize(request.Plan));
        var now = time.GetUtcNow();
        var play = new Play(Guid.NewGuid(), account, instrument, source, plan, now);
        var review = play.Annotate(request.Title ?? "", PlayDocuments.NormalizeDrawings(request.Drawings),
            request.Review ?? "", now, request.StructuredReview);
        store.Add(play);
        if (review is not null) store.Add(review);
        await store.SaveAsync(ct);
        return ToDto(play);
    }

    /// <summary>Holds the Play while it checks entry fills and saves, so no order links to an entry this revision changes in between.</summary>
    public Task<PlayDto> UpdateAsync(Guid id, UpdatePlayRequest request, CancellationToken ct) => store.WithPlayLockAsync(id, async () =>
    {
        var play = await Find(id, ct);
        RequireVersion(play, request.ExpectedVersion);
        if (request.Plan is null) throw new ProblemException(400, "A plan compatibility document is required.");
        // Retrospectives keep an empty compatibility document, not a manufactured plan.
        var plan = play.Origin == PlayOrigin.Retrospective
            ? PlayDocuments.Serialize(request.Plan) : PlayDocuments.Serialize(PlayDocuments.Normalize(request.Plan));
        var drawings = PlayDocuments.NormalizeDrawings(request.Drawings);
        var now = time.GetUtcNow();
        if (request.AccountId != play.AccountId || request.Instrument != play.ContractId ||
            request.InstrumentSource != SourceName(play.InstrumentSource))
        {
            var account = play.Status == PlayStatus.Draft ? await EnabledAccount(request.AccountId, ct)
                : throw new ProblemException(409, "The account and instrument are fixed once a Play is planned.");
            var (instrument, source) = Instrument(account, request.Instrument, request.InstrumentSource);
            play.MoveTo(account, instrument, source, now);
        }
        if (play.Status != PlayStatus.Draft && plan != play.Plan) await RequireFilledEntriesKept(play, request.Plan, ct);
        var revision = play.ChangePlan(plan, request.RevisionReason, now);
        var review = play.Annotate(request.Title ?? "", drawings, request.Review ?? "", now, request.StructuredReview);
        if (revision is not null) store.Add(revision);
        if (review is not null) store.Add(review);
        await store.SaveAsync(ct);
        return ToDto(play);
    }, ct, destinationAccountId: request.AccountId);

    public Task<PlayDto> ChangeStatusAsync(Guid id, ChangePlayStatusRequest request, CancellationToken ct) =>
        store.WithPlayLockAsync(id, async () =>
    {
        var play = await Find(id, ct);
        RequireVersion(play, request.ExpectedVersion);
        var now = time.GetUtcNow();
        switch (request.Status, play.Status)
        {
            case ("planned", PlayStatus.Draft):
                await EnabledAccount(play.AccountId, ct);
                PlayDocuments.RequirePlannable(PlayDocuments.Read(play.Plan));
                var (change, revision) = play.MarkPlanned(now);
                store.Add(change);
                store.Add(revision);
                break;
            case ("planned", _):
                store.Add(play.Resume(now));
                break;
            case ("paused", _):
                store.Add(play.Pause(now));
                break;
            case ("cancelled", _):
                var reason = request.Reason switch
                {
                    "invalidated" => CancelReason.Invalidated,
                    "missed" => CancelReason.Missed,
                    "changed-mind" => CancelReason.ChangedMind,
                    "expired" => CancelReason.Expired,
                    "mistake" => CancelReason.Mistake,
                    "other" => CancelReason.Other,
                    _ => throw new ProblemException(400, "Cancel reasons are invalidated, missed, changed-mind, expired, mistake or other.")
                };
                store.Add(play.Cancel(reason, request.Note, now));
                break;
            default:
                throw new ProblemException(400, "Status must be planned, paused or cancelled.");
        }
        await store.SaveAsync(ct);
        return ToDto(play);
    }, ct);

    public async Task<PlayHistoryDto> HistoryAsync(Guid id, CancellationToken ct)
    {
        var play = await Find(id, ct);
        var revisions = await store.RevisionsAsync(play.Id, ct);
        var changes = await store.StatusChangesAsync(play.Id, ct);
        var reviews = await store.ReviewsAsync(play.Id, ct);
        return new(revisions.Select(r => new PlanRevisionDto(r.Number, StatusName(r.Status), r.Reason, r.CreatedAtUtc, PlayDocuments.Read(r.Plan))).ToList(),
            changes.Select(c => new StatusChangeDto(StatusName(c.From), StatusName(c.To), c.Reason is { } reason ? ReasonName(reason) : null,
                c.Note, c.OccurredAtUtc, c.Source == StatusChangeSource.Venue ? "venue" : "owner")).ToList(),
            reviews.Select(r => new ReviewRevisionDto(r.Number, r.OccurredAtUtc, r.Review,
                JsonSerializer.Deserialize<ReviewAnswers>(r.StructuredReview)!)).ToList());
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct)
    {
        var play = await Find(id, ct);
        if (play.Status != PlayStatus.Draft)
            throw new ProblemException(409, "Only Drafts can be deleted. Cancel a planned Play instead, so its history is kept.");
        foreach (var key in await store.DeleteAsync(play, ct))
        {
            try { await objects.DeleteAsync(key, CancellationToken.None); }
            catch (Exception) { /* Unreferenced objects are harmless; cleanup is a later maintenance task. */ }
        }
    }

    /// <summary>
    /// A filled entry already happened: its price and share cannot be revised, nor the entry removed. The direction
    /// decides which side closes that exposure, so it stays too; the opposite idea is a new Play.
    /// </summary>
    private async Task RequireFilledEntriesKept(Play play, PlayPlanDocument next, CancellationToken ct)
    {
        var filled = await store.FilledEntryIdsAsync(play.Id, ct);
        var current = PlayDocuments.Read(play.Plan);
        var linked = await store.LinkedPlanReferencesAsync(play.Id, ct);
        if ((filled.Count > 0 || linked.Count > 0) && next.Direction != current.Direction)
            throw new ProblemException(409, $"This play has entry fills or linked orders, so it stays {current.Direction}. Start a new play for the opposite idea.");
        foreach (var link in linked.Where(l => l.Role is OrderLinkRole.Stop or OrderLinkRole.Target))
        {
            var oldEntry = current.Entries.FirstOrDefault(e => e.Id == link.EntryId);
            var nextEntry = next.Entries.FirstOrDefault(e => e.Id == link.EntryId);
            var oldLevel = (link.Role == OrderLinkRole.Stop ? oldEntry?.Stops : oldEntry?.Targets)?.FirstOrDefault(l => l.Id == link.LevelId);
            var nextLevel = (link.Role == OrderLinkRole.Stop ? nextEntry?.Stops : nextEntry?.Targets)?.FirstOrDefault(l => l.Id == link.LevelId);
            if (nextEntry is null || nextLevel is null || nextLevel != oldLevel || nextEntry.Price != oldEntry?.Price ||
                nextEntry.Share != oldEntry?.Share ||
                next.Leverage != current.Leverage && oldLevel?.Unit == "percent")
                throw new ProblemException(409, $"Order {link.OrderId} still references this plan level. Unlink it before changing or removing the level.");
        }
        var before = current.Entries.ToDictionary(e => e.Id);
        foreach (var id in filled)
        {
            if (!before.TryGetValue(id, out var old)) continue;
            var now = next.Entries.FirstOrDefault(e => e.Id == id);
            if (now is null || now.Price != old.Price || now.Share != old.Share)
                throw new ProblemException(409, $"{old.Name} has fills or linked orders, so its price and share stay as planned. Unlinked stops and targets can still change.");
        }
    }

    private async Task<Play> Find(Guid id, CancellationToken ct) =>
        await store.FindAsync(id, ct) ?? throw new ProblemException(404, "Play not found.");

    private async Task<Account> EnabledAccount(Guid id, CancellationToken ct)
    {
        var account = await store.AccountAsync(id, ct) ?? throw new ProblemException(404, "Account not found.");
        return account.IsEnabled ? account : throw new ProblemException(409, "Enable the account before using it for a Play.");
    }

    private static void RequireVersion(Play play, long expected)
    {
        if (play.Version != expected)
            throw new ProblemException(409, "This Play changed elsewhere. Reload it before saving again.");
    }

    private static (PerpetualInstrument?, InstrumentSource) Instrument(Account account, string? instrument, string? source)
    {
        var kind = source switch
        {
            "venue" when account.VenueId != "manual" => InstrumentSource.Venue,
            "venue" => throw new ProblemException(400, "Manual accounts use manual instrument labels."),
            "manual" => InstrumentSource.Manual,
            _ => throw new ProblemException(400, "Instrument source must be venue or manual.")
        };
        if (string.IsNullOrEmpty(instrument)) return (null, kind);
        var valid = kind == InstrumentSource.Venue ? ContractPattern().IsMatch(instrument)
            : instrument.Length <= 64 && instrument == instrument.Trim() && !instrument.Any(char.IsControl);
        return valid ? (new PerpetualInstrument(account.VenueId, instrument), kind)
            : throw new ProblemException(400, kind == InstrumentSource.Venue ? "Venue instruments use their contract ID."
                : "Manual instrument labels have at most 64 characters without surrounding spaces.");
    }

    public static string StatusName(PlayStatus status) => status.ToString().ToLowerInvariant();
    private static string SourceName(InstrumentSource source) => source == InstrumentSource.Venue ? "venue" : "manual";
    private static string ReasonName(CancelReason reason) => reason == CancelReason.ChangedMind ? "changed-mind" : reason.ToString().ToLowerInvariant();

    public static PlaySummaryDto Summary(Play play) => new(play.Id, play.Title, StatusName(play.Status), play.AccountId, play.VenueId,
        play.ContractId, SourceName(play.InstrumentSource), PlayDocuments.Read(play.Plan).Direction, play.PlanRevision, play.Version,
        play.CancelReason is { } reason ? ReasonName(reason) : null, play.CreatedAtUtc, play.UpdatedAtUtc, play.PlannedAtUtc, play.EndedAtUtc,
        play.HasReview, play.Origin == PlayOrigin.Retrospective ? "retrospective" : "planned", play.ReviewedAtUtc);

    public static PlayDto ToDto(Play play) =>
        new(Summary(play), PlayDocuments.Read(play.Plan), PlayDocuments.ReadDrawings(play.Drawings), play.Review, play.Answers);

    [GeneratedRegex("^[A-Za-z0-9_-]{1,32}$")]
    private static partial Regex ContractPattern();
}
