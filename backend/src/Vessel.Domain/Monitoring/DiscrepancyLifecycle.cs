namespace Vessel.Domain.Monitoring;

public enum DiscrepancyInputKind { FreshPresent, FreshAbsent, Incomplete, ExpiryTick, Dismiss }

/// <summary>One observation or owner action applied to a discrepancy record.</summary>
public sealed record DiscrepancyInput(DiscrepancyInputKind Kind, DateTimeOffset Now)
{
    /// <summary>Source observation time of a fresh decision.</summary>
    public DateTimeOffset ObservedAtUtc { get; init; }
    public string Fingerprint { get; init; } = "";
    public string Details { get; init; } = "{}";
    public Guid[] PlayIds { get; init; } = [];
    public TimeSpan Lifetime { get; init; }
    public string? Note { get; init; }

    public static DiscrepancyInput Present(DateTimeOffset now, DateTimeOffset at, string fingerprint, string details, Guid[] plays) =>
        new(DiscrepancyInputKind.FreshPresent, now) { ObservedAtUtc = at, Fingerprint = fingerprint, Details = details, PlayIds = plays };
    public static DiscrepancyInput Absent(DateTimeOffset now, DateTimeOffset at, string fingerprint, string details, Guid[] plays) =>
        new(DiscrepancyInputKind.FreshAbsent, now) { ObservedAtUtc = at, Fingerprint = fingerprint, Details = details, PlayIds = plays };
    public static DiscrepancyInput Unknown(DateTimeOffset now) => new(DiscrepancyInputKind.Incomplete, now);
    public static DiscrepancyInput Expiry(DateTimeOffset now, TimeSpan lifetime) => new(DiscrepancyInputKind.ExpiryTick, now) { Lifetime = lifetime };
    public static DiscrepancyInput Dismissal(DateTimeOffset now, string? note) => new(DiscrepancyInputKind.Dismiss, now) { Note = note };
}

/// <param name="Publish">The transition to publish (opened, resolved, dismissed, unverifiable), already recorded with
/// its revision; null when nothing is announced.</param>
/// <param name="ConfirmationDueAtUtc">When a pending confirmation can complete.</param>
/// <param name="Rejected">The owner action is not allowed in this state.</param>
public sealed record DiscrepancyTransition(string? Publish = null, DateTimeOffset? ConfirmationDueAtUtc = null, bool Rejected = false)
{
    public static readonly DiscrepancyTransition None = new();
}

/// <summary>
/// The discrepancy state machine: (record, input) to (record, announcement). Deterministic and free of I/O.
/// Rules: a condition opens only after an uninterrupted fresh confirmation; an open warning follows its evidence
/// silently; anything ever announced stays visible; every announcement (opened, unverifiable) gets exactly one
/// matching close (resolved or dismissed); expiry ends verification without a decision and never resolves.
/// </summary>
public static class DiscrepancyLifecycle
{
    public const string Candidate = "candidate", Open = "open", Resolved = "resolved", Dismissed = "dismissed";
    public const string Opened = "opened", Unverifiable = "unverifiable";
    public static readonly TimeSpan ConfirmationDelay = TimeSpan.FromSeconds(60);

    public static DiscrepancyTransition Apply(PlayDiscrepancy row, DiscrepancyInput input) => input.Kind switch
    {
        DiscrepancyInputKind.FreshPresent => Present(row, input),
        DiscrepancyInputKind.FreshAbsent => Absent(row, input),
        DiscrepancyInputKind.Incomplete => Interrupt(row),
        DiscrepancyInputKind.ExpiryTick => Expire(row, input),
        DiscrepancyInputKind.Dismiss => Dismiss(row, input),
        _ => throw new ArgumentOutOfRangeException(nameof(input))
    };

    private static DiscrepancyTransition Present(PlayDiscrepancy row, DiscrepancyInput input)
    {
        row.UnverifiableAtUtc = null;
        row.LastObservedAtUtc = input.ObservedAtUtc;
        if (row.State == Open)
        {
            Settle(row);
            Baseline(row, input);
            return DiscrepancyTransition.None;
        }
        if (row.State == Dismissed && row.Fingerprint == input.Fingerprint)
        {
            // The dismissed evidence is back. A pending unverifiable announcement closes as dismissed again.
            Settle(row);
            return row.PublishedTransition == Unverifiable ? Announce(row, Dismissed) : DiscrepancyTransition.None;
        }
        // A candidate's evidence is its baseline. Resolved and dismissed records keep theirs until confirmation.
        if (row.State == Candidate) Baseline(row, input);
        if (row.PendingFingerprint != input.Fingerprint || row.PendingSinceUtc is null)
        {
            row.PendingFingerprint = input.Fingerprint;
            row.PendingSinceUtc = input.ObservedAtUtc;
        }
        var due = row.PendingSinceUtc.Value + ConfirmationDelay;
        if (input.ObservedAtUtc < due) return new(ConfirmationDueAtUtc: due);
        var first = row.PendingSinceUtc.Value;
        Settle(row);
        Baseline(row, input);
        row.State = Open;
        row.OpenedAtUtc = first;
        row.ConfirmedAtUtc = input.Now;
        row.ResolvedAtUtc = row.DismissedAtUtc = null;
        row.Note = null;
        return Announce(row, Opened);
    }

    private static DiscrepancyTransition Absent(PlayDiscrepancy row, DiscrepancyInput input)
    {
        row.UnverifiableAtUtc = null;
        row.LastObservedAtUtc = input.ObservedAtUtc;
        Settle(row);
        var close = row.PublicOpen;
        // A resolved record keeps its historical resolution; only a pending announcement needs closing.
        if (row.State == Resolved) return close ? Announce(row, Resolved) : DiscrepancyTransition.None;
        row.State = Resolved;
        row.ResolvedAtUtc = input.Now;
        Baseline(row, input);
        if (close) return Announce(row, Resolved);
        row.Revision++;
        return DiscrepancyTransition.None;
    }

    private static DiscrepancyTransition Interrupt(PlayDiscrepancy row)
    {
        // Unknown evidence breaks the confirmation sequence; the outstanding work itself stays.
        row.PendingSinceUtc = null;
        return DiscrepancyTransition.None;
    }

    private static DiscrepancyTransition Expire(PlayDiscrepancy row, DiscrepancyInput input)
    {
        if (!row.HasWork || input.Now - row.LastObservedAtUtc < input.Lifetime) return DiscrepancyTransition.None;
        row.UnverifiableAtUtc = input.Now;
        row.PendingSinceUtc = null;
        return Announce(row, Unverifiable);
    }

    private static DiscrepancyTransition Dismiss(PlayDiscrepancy row, DiscrepancyInput input)
    {
        // Repeating a dismissal is a no-op, unless a later unverifiable announcement still awaits its close.
        if (row.State == Dismissed && !row.PublicOpen) return DiscrepancyTransition.None;
        if (!row.PublicOpen) return new(Rejected: true);
        // The dismissed evidence is the pending recurrence, if any, so its return stays dismissed.
        if (row.PendingFingerprint is { } pending) row.Fingerprint = pending;
        Settle(row);
        row.State = Dismissed;
        row.DismissedAtUtc = input.Now;
        row.Note = input.Note;
        return Announce(row, Dismissed);
    }

    private static void Settle(PlayDiscrepancy row) { row.PendingFingerprint = null; row.PendingSinceUtc = null; }

    private static void Baseline(PlayDiscrepancy row, DiscrepancyInput input)
    {
        row.InvolvedPlayIds = input.PlayIds;
        row.Details = input.Details;
        row.Fingerprint = input.Fingerprint;
    }

    private static DiscrepancyTransition Announce(PlayDiscrepancy row, string transition)
    {
        row.Revision++;
        row.PublishedTransition = transition;
        row.PublishedRevision = row.Revision;
        return new(transition);
    }
}
