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
    public string? PendingFingerprint { get; set; }
    public DateTimeOffset? PendingSinceUtc { get; set; }

    /// <summary>Unknown observations break a confirmation sequence without resolving or reviving a warning.</summary>
    public void InterruptConfirmation() { PendingFingerprint = null; PendingSinceUtc = null; }
}
