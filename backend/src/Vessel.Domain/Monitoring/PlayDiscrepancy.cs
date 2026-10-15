using Vessel.Domain.Common;

namespace Vessel.Domain.Monitoring;

/// <summary>One current discrepancy per account/kind/subject. Candidates are internal, never public warnings.</summary>
public sealed class PlayDiscrepancy : IOwned
{
    public const int MaxNoteLength = 2000;
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OwnerId { get; set; }
    public Guid AccountId { get; set; }
    public Guid? PlayId { get; set; }
    public Guid[] InvolvedPlayIds { get; set; } = [];
    public string ContractId { get; set; } = "";
    public string NativeContractId { get; set; } = "";
    public string SubjectKey { get; set; } = "";
    public string Kind { get; set; } = "";
    public string Severity { get; set; } = "";
    public string State { get; set; } = "candidate";
    public string Fingerprint { get; set; } = "";
    public string Details { get; set; } = "{}";
    public DateTimeOffset OpenedAtUtc { get; set; }
    public DateTimeOffset? ConfirmedAtUtc { get; set; }
    public DateTimeOffset? ResolvedAtUtc { get; set; }
    public DateTimeOffset? DismissedAtUtc { get; set; }
    public string? Note { get; set; }
    public long Revision { get; set; }
    public DateTimeOffset LastObservedAtUtc { get; set; }
    /// <summary>
    /// The condition awaiting (re-)confirmation, whatever the public state. It is durable monitoring work: it keeps the
    /// account checked until a fresh observation confirms or clears it.
    /// </summary>
    public string? PendingFingerprint { get; set; }
    /// <summary>Start of the current uninterrupted confirmation sequence; null after an unknown observation.</summary>
    public DateTimeOffset? PendingSinceUtc { get; set; }
    /// <summary>
    /// Set when the subject stayed unobservable beyond the monitor's lifetime. The record is not resolved: it stays
    /// visible with an unverifiable outcome and no longer holds the account's monitoring. Cleared by a fresh decision.
    /// </summary>
    public DateTimeOffset? UnverifiableAtUtc { get; set; }

    public bool AwaitsConfirmation => PendingFingerprint is not null;

    /// <summary>Unknown observations break a confirmation sequence without resolving or reviving a warning. The
    /// outstanding confirmation itself stays recorded.</summary>
    public void InterruptConfirmation() => PendingSinceUtc = null;

    /// <summary>A fresh decision confirmed, cleared or matched the record: nothing awaits confirmation.</summary>
    public void SettleConfirmation() { PendingFingerprint = null; PendingSinceUtc = null; }
}
