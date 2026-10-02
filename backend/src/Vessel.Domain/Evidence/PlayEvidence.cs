using Vessel.Domain.Plays;

namespace Vessel.Domain.Evidence;

public enum EvidenceSource { Capture, Upload }

// An image attached to a saved Play with the owner's note. The bytes live in evidence storage
// under ObjectKey; this record holds what the application needs to authorize and verify them.
public sealed class PlayEvidence
{
    public const int MaxNoteLength = 4000;

    public Guid Id { get; private set; }
    public Guid OwnerId { get; private set; }
    public Guid PlayId { get; private set; }
    public string ObjectKey { get; private set; } = null!;
    public string ContentType { get; private set; } = null!;
    public long SizeBytes { get; private set; }
    public string Sha256 { get; private set; } = null!;
    public EvidenceSource Source { get; private set; }
    public string Note { get; private set; } = "";
    /// <summary>Normalized markup JSON drawn over the image, or null. The image bytes stay original.</summary>
    public string? Markup { get; private set; }
    public DateTimeOffset CreatedAtUtc { get; private set; }
    public DateTimeOffset UpdatedAtUtc { get; private set; }
    private PlayEvidence() { }

    public PlayEvidence(Guid id, Play play, string objectKey, string contentType, long sizeBytes, string sha256,
        EvidenceSource source, string note, DateTimeOffset now)
    {
        if (id == Guid.Empty) throw new ArgumentException("Evidence ID must be nonempty.");
        ArgumentNullException.ThrowIfNull(play);
        ArgumentException.ThrowIfNullOrWhiteSpace(objectKey);
        ArgumentException.ThrowIfNullOrWhiteSpace(contentType);
        if (sizeBytes <= 0) throw new ArgumentException("Evidence must contain bytes.");
        if (sha256.Length != 64) throw new ArgumentException("SHA-256 must be 64 hexadecimal characters.");
        Id = id;
        OwnerId = play.OwnerId;
        PlayId = play.Id;
        ObjectKey = objectKey;
        ContentType = contentType;
        SizeBytes = sizeBytes;
        Sha256 = sha256;
        Source = source;
        Note = ValidNote(note);
        CreatedAtUtc = now;
        UpdatedAtUtc = now;
    }

    public void UpdateNote(string note, DateTimeOffset now)
    {
        Note = ValidNote(note);
        UpdatedAtUtc = now;
    }

    public void UpdateMarkup(string? markup, DateTimeOffset now)
    {
        Markup = markup;
        UpdatedAtUtc = now;
    }

    private static string ValidNote(string note)
    {
        ArgumentNullException.ThrowIfNull(note);
        if (note.Length > MaxNoteLength) throw new ArgumentException($"Notes are limited to {MaxNoteLength} characters.");
        return note;
    }
}
