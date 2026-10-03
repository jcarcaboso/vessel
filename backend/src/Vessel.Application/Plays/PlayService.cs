using System.Text.RegularExpressions;
using Vessel.Application.Evidence;
using Vessel.Application.Workspace;
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
        Apply(() => play.Annotate(request.Title ?? "", PlayDocuments.NormalizeDrawings(request.Drawings), request.Review ?? "", now));
        store.Add(play);
        await store.SaveAsync(ct);
        return ToDto(play);
    }

    public async Task<PlayDto> UpdateAsync(Guid id, UpdatePlayRequest request, CancellationToken ct)
    {
        var play = await Find(id, ct);
        RequireVersion(play, request.ExpectedVersion);
        var plan = PlayDocuments.Serialize(PlayDocuments.Normalize(request.Plan));
        var drawings = PlayDocuments.NormalizeDrawings(request.Drawings);
        var now = time.GetUtcNow();
        if (request.AccountId != play.AccountId || request.Instrument != play.ContractId ||
            request.InstrumentSource != SourceName(play.InstrumentSource))
        {
            var account = play.Status == PlayStatus.Draft ? await EnabledAccount(request.AccountId, ct)
                : throw new WorkspaceException(409, "The account and instrument are fixed once a Play is planned.");
            var (instrument, source) = Instrument(account, request.Instrument, request.InstrumentSource);
            Apply(() => play.MoveTo(account, instrument, source, now));
        }
        var revision = Apply(() => play.ChangePlan(plan, request.RevisionReason, now));
        Apply(() => play.Annotate(request.Title ?? "", drawings, request.Review ?? "", now));
        if (revision is not null) store.Add(revision);
        await store.SaveAsync(ct);
        return ToDto(play);
    }

    public async Task<PlayDto> ChangeStatusAsync(Guid id, ChangePlayStatusRequest request, CancellationToken ct)
    {
        var play = await Find(id, ct);
        RequireVersion(play, request.ExpectedVersion);
        var now = time.GetUtcNow();
        switch (request.Status, play.Status)
        {
            case ("planned", PlayStatus.Draft):
                await EnabledAccount(play.AccountId, ct);
                PlayDocuments.RequirePlannable(PlayDocuments.Read(play.Plan));
                var (change, revision) = Apply(() => play.MarkPlanned(now));
                store.Add(change);
                store.Add(revision);
                break;
            case ("planned", _):
                store.Add(Apply(() => play.Resume(now)));
                break;
            case ("paused", _):
                store.Add(Apply(() => play.Pause(now)));
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
                    _ => throw new WorkspaceException(400, "Cancel reasons are invalidated, missed, changed-mind, expired, mistake or other.")
                };
                store.Add(Apply(() => play.Cancel(reason, request.Note, now)));
                break;
            default:
                throw new WorkspaceException(400, "Status must be planned, paused or cancelled.");
        }
        await store.SaveAsync(ct);
        return ToDto(play);
    }

    public async Task<PlayHistoryDto> HistoryAsync(Guid id, CancellationToken ct)
    {
        var play = await Find(id, ct);
        var revisions = await store.RevisionsAsync(play.Id, ct);
        var changes = await store.StatusChangesAsync(play.Id, ct);
        return new(revisions.Select(r => new PlanRevisionDto(r.Number, StatusName(r.Status), r.Reason, r.CreatedAtUtc, PlayDocuments.Read(r.Plan))).ToList(),
            changes.Select(c => new StatusChangeDto(StatusName(c.From), StatusName(c.To), c.Reason is { } reason ? ReasonName(reason) : null,
                c.Note, c.OccurredAtUtc)).ToList());
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct)
    {
        var play = await Find(id, ct);
        if (play.Status != PlayStatus.Draft)
            throw new WorkspaceException(409, "Only Drafts can be deleted. Cancel a planned Play instead, so its history is kept.");
        foreach (var key in await store.DeleteAsync(play, ct))
        {
            try { await objects.DeleteAsync(key, CancellationToken.None); }
            catch (Exception) { /* Unreferenced objects are harmless; cleanup is a later maintenance task. */ }
        }
    }

    private async Task<Play> Find(Guid id, CancellationToken ct) =>
        await store.FindAsync(id, ct) ?? throw new WorkspaceException(404, "Play not found.");

    private async Task<Account> EnabledAccount(Guid id, CancellationToken ct)
    {
        var account = await store.AccountAsync(id, ct) ?? throw new WorkspaceException(404, "Account not found.");
        return account.IsEnabled ? account : throw new WorkspaceException(409, "Enable the account before using it for a Play.");
    }

    private static void RequireVersion(Play play, long expected)
    {
        if (play.Version != expected)
            throw new WorkspaceException(409, "This Play changed elsewhere. Reload it before saving again.");
    }

    private static (PerpetualInstrument?, InstrumentSource) Instrument(Account account, string? instrument, string? source)
    {
        var kind = source switch
        {
            "venue" when account.VenueId != "manual" => InstrumentSource.Venue,
            "venue" => throw new WorkspaceException(400, "Manual accounts use manual instrument labels."),
            "manual" => InstrumentSource.Manual,
            _ => throw new WorkspaceException(400, "Instrument source must be venue or manual.")
        };
        if (string.IsNullOrEmpty(instrument)) return (null, kind);
        var valid = kind == InstrumentSource.Venue ? ContractPattern().IsMatch(instrument)
            : instrument.Length <= 64 && instrument == instrument.Trim() && !instrument.Any(char.IsControl);
        return valid ? (new PerpetualInstrument(account.VenueId, instrument), kind)
            : throw new WorkspaceException(400, kind == InstrumentSource.Venue ? "Venue instruments use their contract ID."
                : "Manual instrument labels have at most 64 characters without surrounding spaces.");
    }

    private static T Apply<T>(Func<T> action)
    {
        try { return action(); }
        catch (PlayRuleException error) { throw new WorkspaceException(409, error.Message); }
        catch (ArgumentException error) { throw new WorkspaceException(400, error.Message); }
    }

    private static void Apply(Action action) => Apply(() => { action(); return true; });

    public static string StatusName(PlayStatus status) => status.ToString().ToLowerInvariant();
    private static string SourceName(InstrumentSource source) => source == InstrumentSource.Venue ? "venue" : "manual";
    private static string ReasonName(CancelReason reason) => reason == CancelReason.ChangedMind ? "changed-mind" : reason.ToString().ToLowerInvariant();

    private static PlaySummaryDto Summary(Play play) => new(play.Id, play.Title, StatusName(play.Status), play.AccountId, play.VenueId,
        play.ContractId, SourceName(play.InstrumentSource), PlayDocuments.Read(play.Plan).Direction, play.PlanRevision, play.Version,
        play.CancelReason is { } reason ? ReasonName(reason) : null, play.CreatedAtUtc, play.UpdatedAtUtc, play.PlannedAtUtc, play.EndedAtUtc);

    private static PlayDto ToDto(Play play) =>
        new(Summary(play), PlayDocuments.Read(play.Plan), PlayDocuments.ReadDrawings(play.Drawings), play.Review);

    [GeneratedRegex("^[A-Za-z0-9_-]{1,32}$")]
    private static partial Regex ContractPattern();
}
