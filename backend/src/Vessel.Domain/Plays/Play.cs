using Vessel.Domain.Accounts;
using Vessel.Domain.Markets;

namespace Vessel.Domain.Plays;

// Open and Closed are reached from linked venue fills, which arrive with order linking.
public enum PlayStatus { Draft, Planned, Paused, Open, Closed, Cancelled }

public enum InstrumentSource { Venue, Manual }

public enum CancelReason { Invalidated, Missed, ChangedMind, Expired, Mistake, Other }

// One trading idea. The plan is an application-validated JSON document; after planning, every plan
// change is an append-only revision. It contains neither inferred executions nor an invented thesis.
public sealed class Play
{
    public const int MaxTitleLength = 200;
    public const int MaxReviewLength = 20000;
    public const int MaxCancelNoteLength = 2000;

    public Guid Id { get; private set; }
    public Guid OwnerId { get; private set; }
    public Guid AccountId { get; private set; }
    public string VenueId { get; private set; } = null!;
    /// <summary>Venue contract ID or manual label; null while a Draft has no instrument.</summary>
    public string? ContractId { get; private set; }
    public InstrumentSource InstrumentSource { get; private set; }
    public PerpetualInstrument? Instrument => ContractId is null ? null : new(VenueId, ContractId);
    public PlayStatus Status { get; private set; }
    public string Title { get; private set; } = "";
    public string Plan { get; private set; } = null!;
    public string Drawings { get; private set; } = "{}";
    public string Review { get; private set; } = "";
    /// <summary>The latest plan revision number; zero while the Play is a Draft.</summary>
    public int PlanRevision { get; private set; }
    /// <summary>Increases on every change, for optimistic concurrency.</summary>
    public long Version { get; private set; }
    public CancelReason? CancelReason { get; private set; }
    public DateTimeOffset CreatedAtUtc { get; private set; }
    public DateTimeOffset UpdatedAtUtc { get; private set; }
    public DateTimeOffset? PlannedAtUtc { get; private set; }
    public DateTimeOffset? EndedAtUtc { get; private set; }
    private Play() { }

    public Play(Guid id, Account account, PerpetualInstrument? instrument, InstrumentSource source, string plan, DateTimeOffset now)
    {
        if (id == Guid.Empty) throw new ArgumentException("Play ID must be nonempty.");
        ArgumentNullException.ThrowIfNull(account);
        ArgumentException.ThrowIfNullOrWhiteSpace(plan);
        Id = id;
        OwnerId = account.OwnerId;
        AccountId = account.Id;
        VenueId = account.VenueId;
        SetInstrument(instrument, source);
        Status = PlayStatus.Draft;
        Plan = plan;
        Version = 1;
        CreatedAtUtc = now;
        UpdatedAtUtc = now;
    }

    public bool IsEditable => Status is PlayStatus.Draft or PlayStatus.Planned or PlayStatus.Paused or PlayStatus.Open;

    /// <summary>Account and instrument are part of the idea until it is planned.</summary>
    public void MoveTo(Account account, PerpetualInstrument? instrument, InstrumentSource source, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(account);
        if (account.OwnerId != OwnerId) throw new ArgumentException("Account belongs to another owner.");
        if (account.Id == AccountId && instrument == Instrument && source == InstrumentSource) return;
        if (Status != PlayStatus.Draft) throw new PlayRuleException("The account and instrument are fixed once a Play is planned.");
        AccountId = account.Id;
        VenueId = account.VenueId;
        SetInstrument(instrument, source);
        Touch(now);
    }

    public void Annotate(string title, string drawings, string review, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(title);
        ArgumentNullException.ThrowIfNull(review);
        ArgumentException.ThrowIfNullOrWhiteSpace(drawings);
        title = title.Trim();
        if (title.Length > MaxTitleLength) throw new ArgumentException($"Titles are limited to {MaxTitleLength} characters.");
        if (review.Length > MaxReviewLength) throw new ArgumentException($"Reviews are limited to {MaxReviewLength} characters.");
        if (title == Title && drawings == Drawings && review == Review) return;
        if (!IsEditable && (title != Title || drawings != Drawings))
            throw new PlayRuleException("Closed and cancelled Plays keep their plan; only the review can change.");
        Title = title;
        Drawings = drawings;
        Review = review;
        Touch(now);
    }

    /// <summary>Changes a Draft's plan without a revision, or records the next revision of a planned one.</summary>
    public PlayPlanRevision? ChangePlan(string plan, string? reason, DateTimeOffset now)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(plan);
        if (plan == Plan) return null;
        if (!IsEditable) throw new PlayRuleException("Closed and cancelled Plays keep their plan.");
        if (Status == PlayStatus.Draft)
        {
            Plan = plan;
            Touch(now);
            return null;
        }
        if (string.IsNullOrWhiteSpace(reason)) throw new PlayRuleException("Say why the plan changed. The reason is kept with the revision.");
        Plan = plan;
        Touch(now);
        return new PlayPlanRevision(this, checked(++PlanRevision), reason, now);
    }

    public (PlayStatusChange Change, PlayPlanRevision Revision) MarkPlanned(DateTimeOffset now)
    {
        if (Status != PlayStatus.Draft) throw new PlayRuleException("Only a Draft can be planned.");
        if (ContractId is null) throw new PlayRuleException("Choose an instrument before planning.");
        var change = Transition(PlayStatus.Planned, null, null, now);
        PlannedAtUtc = now;
        PlanRevision = 1;
        return (change, new PlayPlanRevision(this, 1, "Planned", now));
    }

    public PlayStatusChange Pause(DateTimeOffset now) => Status == PlayStatus.Planned
        ? Transition(PlayStatus.Paused, null, null, now)
        : throw new PlayRuleException("Only a planned Play without fills can be paused.");

    public PlayStatusChange Resume(DateTimeOffset now) => Status == PlayStatus.Paused
        ? Transition(PlayStatus.Planned, null, null, now)
        : throw new PlayRuleException("Only a paused Play can be resumed.");

    public PlayStatusChange Cancel(CancelReason reason, string? note, DateTimeOffset now)
    {
        if (Status is not (PlayStatus.Draft or PlayStatus.Planned or PlayStatus.Paused))
            throw new PlayRuleException("Only a Play without fills can be cancelled.");
        if (!Enum.IsDefined(reason)) throw new ArgumentException("Unknown cancel reason.");
        var change = Transition(PlayStatus.Cancelled, reason, note, now);
        CancelReason = reason;
        EndedAtUtc = now;
        return change;
    }

    private PlayStatusChange Transition(PlayStatus to, CancelReason? reason, string? note, DateTimeOffset now)
    {
        var change = new PlayStatusChange(this, Status, to, reason, note, now);
        Status = to;
        Touch(now);
        return change;
    }

    private void SetInstrument(PerpetualInstrument? instrument, InstrumentSource source)
    {
        if (instrument is not null && instrument.VenueId != VenueId)
            throw new ArgumentException("Instrument must belong to the account venue.");
        if (!Enum.IsDefined(source)) throw new ArgumentException("Unknown instrument source.");
        ContractId = instrument?.ContractId;
        InstrumentSource = source;
    }

    private void Touch(DateTimeOffset now)
    {
        Version = checked(Version + 1);
        UpdatedAtUtc = now;
    }
}

/// <summary>A lifecycle rule the request broke, as opposed to malformed input.</summary>
public sealed class PlayRuleException(string message) : Exception(message);

/// <summary>An append-only snapshot of a planned Play's plan and the reason it changed.</summary>
public sealed class PlayPlanRevision
{
    public const int MaxReasonLength = 2000;

    public Guid Id { get; private set; }
    public Guid OwnerId { get; private set; }
    public Guid PlayId { get; private set; }
    public int Number { get; private set; }
    public PlayStatus Status { get; private set; }
    public string Plan { get; private set; } = null!;
    public string Reason { get; private set; } = null!;
    public DateTimeOffset CreatedAtUtc { get; private set; }
    private PlayPlanRevision() { }

    internal PlayPlanRevision(Play play, int number, string reason, DateTimeOffset now)
    {
        reason = reason.Trim();
        if (reason.Length > MaxReasonLength) throw new ArgumentException($"Reasons are limited to {MaxReasonLength} characters.");
        Id = Guid.NewGuid();
        OwnerId = play.OwnerId;
        PlayId = play.Id;
        Number = number;
        Status = play.Status;
        Plan = play.Plan;
        Reason = reason;
        CreatedAtUtc = now;
    }
}

public sealed class PlayStatusChange
{
    public Guid Id { get; private set; }
    public Guid OwnerId { get; private set; }
    public Guid PlayId { get; private set; }
    public PlayStatus From { get; private set; }
    public PlayStatus To { get; private set; }
    public CancelReason? Reason { get; private set; }
    public string? Note { get; private set; }
    public DateTimeOffset OccurredAtUtc { get; private set; }
    private PlayStatusChange() { }

    internal PlayStatusChange(Play play, PlayStatus from, PlayStatus to, CancelReason? reason, string? note, DateTimeOffset now)
    {
        note = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
        if (note?.Length > Play.MaxCancelNoteLength) throw new ArgumentException($"Notes are limited to {Play.MaxCancelNoteLength} characters.");
        Id = Guid.NewGuid();
        OwnerId = play.OwnerId;
        PlayId = play.Id;
        From = from;
        To = to;
        Reason = reason;
        Note = note;
        OccurredAtUtc = now;
    }
}
