using System.Security.Cryptography;
using Vessel.Application.Ownership;
using Vessel.Application.Workspace;
using Vessel.Domain.Evidence;

namespace Vessel.Application.Evidence;

/// <summary>
/// Evidence images of saved Plays. Bytes are written before metadata, so a failure leaves at most an
/// unreferenced object, never a record without an image. Drafts keep their images in the browser.
/// </summary>
public sealed class EvidenceService(IEvidenceMetadataStore store, IEvidenceObjectStore objects, EvidenceLimits limits,
    IJournalOwnerContext owner, TimeProvider time)
{
    public async Task<IReadOnlyList<EvidenceDto>> ListAsync(Guid playId, CancellationToken ct)
    {
        _ = await store.PlayAsync(playId, ct) ?? throw new WorkspaceException(404, "Play not found.");
        return (await store.ListAsync(playId, ct)).Select(ToDto).ToList();
    }

    public async Task<EvidenceDto> UploadAsync(Guid playId, Stream content, string? note, string? source, string? markup, CancellationToken ct)
    {
        var play = await store.PlayAsync(playId, ct) ?? throw new WorkspaceException(404, "Play not found.");
        var kind = source switch
        {
            null or "" or "upload" => EvidenceSource.Upload,
            "capture" => EvidenceSource.Capture,
            _ => throw new WorkspaceException(400, "Source must be capture or upload.")
        };
        note = ValidNote(note ?? "");
        var marks = string.IsNullOrEmpty(markup) ? null : EvidenceMarkup.Parse(markup);
        if (await store.CountAsync(playId, ct) >= limits.MaxPerPlay)
            throw new WorkspaceException(409, $"A Play can hold at most {limits.MaxPerPlay} evidence images.");

        var bytes = await ReadBoundedAsync(content, ct);
        var format = EvidenceImage.Detect(bytes) ?? throw new WorkspaceException(415, "Only PNG, JPEG or WebP images are accepted.");
        var id = Guid.NewGuid();
        // Generated from IDs only, so no client text reaches a storage path.
        var key = $"{owner.OwnerId:N}/{playId:N}/{id:N}.{format.Extension}";
        var evidence = new PlayEvidence(id, play, key, format.ContentType, bytes.Length,
            Convert.ToHexStringLower(SHA256.HashData(bytes)), kind, note, time.GetUtcNow());
        if (marks is not null) evidence.UpdateMarkup(EvidenceMarkup.Serialize(marks), evidence.CreatedAtUtc);
        await objects.PutAsync(key, new MemoryStream(bytes, writable: false), ct);
        try { await store.AddAsync(evidence, ct); }
        catch
        {
            await DeleteObjectAsync(key);
            throw;
        }
        return ToDto(evidence);
    }

    public async Task<EvidenceContent> ContentAsync(Guid id, CancellationToken ct)
    {
        var evidence = await store.FindAsync(id, ct) ?? throw new WorkspaceException(404, "Evidence not found.");
        var stream = await objects.OpenReadAsync(evidence.ObjectKey, ct)
            ?? throw new WorkspaceException(404, "The evidence image is missing from storage.");
        return new(stream, evidence.ContentType, evidence.SizeBytes, evidence.Sha256);
    }

    public async Task<EvidenceDto> UpdateNoteAsync(Guid id, UpdateEvidenceNoteRequest request, CancellationToken ct)
    {
        var evidence = await store.FindAsync(id, ct) ?? throw new WorkspaceException(404, "Evidence not found.");
        evidence.UpdateNote(ValidNote(request.Note), time.GetUtcNow());
        await store.SaveAsync(ct);
        return ToDto(evidence);
    }

    /// <summary>Replaces the marks, or clears them with null. The image is unchanged.</summary>
    public async Task<EvidenceDto> UpdateMarkupAsync(Guid id, ImageMarkup? markup, CancellationToken ct)
    {
        var evidence = await store.FindAsync(id, ct) ?? throw new WorkspaceException(404, "Evidence not found.");
        evidence.UpdateMarkup(markup is null ? null : EvidenceMarkup.Serialize(EvidenceMarkup.Normalize(markup)), time.GetUtcNow());
        await store.SaveAsync(ct);
        return ToDto(evidence);
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct)
    {
        var evidence = await store.FindAsync(id, ct) ?? throw new WorkspaceException(404, "Evidence not found.");
        await store.RemoveAsync(evidence, ct);
        // The record is gone; a failed object delete only leaves an unreferenced file behind.
        await DeleteObjectAsync(evidence.ObjectKey);
    }

    private async Task<byte[]> ReadBoundedAsync(Stream content, CancellationToken ct)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int read;
        while ((read = await content.ReadAsync(chunk, ct)) > 0)
        {
            if (buffer.Length + read > limits.MaxUploadBytes)
                throw new WorkspaceException(413, $"Images are limited to {limits.MaxUploadBytes / (1024 * 1024)} MB.");
            buffer.Write(chunk, 0, read);
        }
        if (buffer.Length == 0) throw new WorkspaceException(400, "The image is empty.");
        return buffer.ToArray();
    }

    private async Task DeleteObjectAsync(string key)
    {
        try { await objects.DeleteAsync(key, CancellationToken.None); }
        catch (Exception) { /* Unreferenced objects are harmless; cleanup is a later maintenance task. */ }
    }

    private static string ValidNote(string note) => note.Length <= PlayEvidence.MaxNoteLength ? note
        : throw new WorkspaceException(400, $"Notes are limited to {PlayEvidence.MaxNoteLength} characters.");

    private static EvidenceDto ToDto(PlayEvidence evidence) => new(evidence.Id, evidence.PlayId,
        evidence.Source == EvidenceSource.Capture ? "capture" : "upload", evidence.ContentType, evidence.SizeBytes,
        evidence.Sha256, evidence.Note, evidence.CreatedAtUtc, evidence.UpdatedAtUtc, EvidenceMarkup.Read(evidence.Markup));
}
