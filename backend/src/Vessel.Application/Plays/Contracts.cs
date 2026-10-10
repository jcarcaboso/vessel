using System.Text.Json;
using System.Text.Json.Serialization;
using Vessel.Domain.Accounts;
using Vessel.Domain.Plays;

namespace Vessel.Application.Plays;

public sealed record CreatePlayRequest(
    [property: JsonRequired] Guid AccountId,
    string? Instrument,
    [property: JsonRequired] string InstrumentSource,
    [property: JsonRequired] string Title,
    [property: JsonRequired] PlayPlanDocument Plan,
    JsonElement? Drawings = null,
    string? Review = null);

public sealed record UpdatePlayRequest(
    [property: JsonRequired] long ExpectedVersion,
    [property: JsonRequired] Guid AccountId,
    string? Instrument,
    [property: JsonRequired] string InstrumentSource,
    [property: JsonRequired] string Title,
    [property: JsonRequired] PlayPlanDocument Plan,
    [property: JsonRequired] JsonElement Drawings,
    [property: JsonRequired] string Review,
    string? RevisionReason = null);

/// <summary>Status is planned, paused (from planned), planned again to resume, or cancelled with a reason.</summary>
public sealed record ChangePlayStatusRequest(
    [property: JsonRequired] long ExpectedVersion,
    [property: JsonRequired] string Status,
    string? Reason = null,
    string? Note = null);

public sealed record PlaySummaryDto(Guid Id, string Title, string Status, Guid AccountId, string VenueId, string? Instrument,
    string InstrumentSource, string Direction, int PlanRevision, long Version, string? CancelReason,
    DateTimeOffset CreatedAtUtc, DateTimeOffset UpdatedAtUtc, DateTimeOffset? PlannedAtUtc, DateTimeOffset? EndedAtUtc,
    bool HasReview);

public sealed record PlayDto(PlaySummaryDto Summary, PlayPlanDocument Plan, JsonElement Drawings, string Review);

public sealed record PlanRevisionDto(int Number, string Status, string Reason, DateTimeOffset CreatedAtUtc, PlayPlanDocument Plan);
public sealed record StatusChangeDto(string From, string To, string? Reason, string? Note, DateTimeOffset OccurredAtUtc, string Source = "owner");
public sealed record PlayHistoryDto(IReadOnlyList<PlanRevisionDto> Revisions, IReadOnlyList<StatusChangeDto> StatusChanges);

// Application owns this bounded port; EF details stay in Persistence. Reads are owner-filtered.
public interface IPlayStore
{
    Task<List<Play>> ListAsync(CancellationToken ct);
    Task<Play?> FindAsync(Guid id, CancellationToken ct);
    Task<Account?> AccountAsync(Guid id, CancellationToken ct);
    Task<List<PlayPlanRevision>> RevisionsAsync(Guid playId, CancellationToken ct);
    Task<List<PlayStatusChange>> StatusChangesAsync(Guid playId, CancellationToken ct);
    /// <summary>Entries with at least one linked entry fill; their price, share and existence are fixed.</summary>
    Task<IReadOnlySet<string>> FilledEntryIdsAsync(Guid playId, CancellationToken ct);
    void Add(Play play);
    void Add(PlayPlanRevision revision);
    void Add(PlayStatusChange change);
    /// <summary>Saves pending changes; a concurrent write to the same Play is a 409.</summary>
    Task SaveAsync(CancellationToken ct);
    /// <summary>Deletes the Play with its evidence records and returns the evidence object keys to remove.</summary>
    Task<IReadOnlyList<string>> DeleteAsync(Play play, CancellationToken ct);
}
