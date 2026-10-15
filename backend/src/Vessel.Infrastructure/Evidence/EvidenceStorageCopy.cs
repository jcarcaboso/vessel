using System.Security.Cryptography;
using Vessel.Application.Evidence;

namespace Vessel.Infrastructure.Evidence;

public sealed class EvidenceCopyIntegrityException(string message) : IOException(message);

/// <summary>Offline, metadata-verified copy. Never deletes originals or changes the active provider.</summary>
public sealed class EvidenceStorageCopy
{
    private readonly string root;
    private readonly LocalEvidenceObjectStore source;
    private readonly IEvidenceObjectStore destination;

    public EvidenceStorageCopy(string sourceRoot, IEvidenceObjectStore destination)
    {
        if (!Path.IsPathFullyQualified(sourceRoot))
            throw new ArgumentException("The evidence source must be an absolute directory.");
        root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(sourceRoot));
        if (!Directory.Exists(root)) throw new DirectoryNotFoundException("The evidence source directory is missing.");
        source = new LocalEvidenceObjectStore(root);
        this.destination = destination;
    }

    /// <returns>True when the object was copied (or would be copied in a dry run); false when it already matches.</returns>
    public async Task<bool> CopyAsync(string key, long sizeBytes, string sha256, bool apply, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        EvidenceObjectKey.Validate(key);
        if (sizeBytes <= 0 || sha256.Length != 64 || sha256.Any(c => c is not (>= '0' and <= '9' or >= 'a' and <= 'f')))
            throw new EvidenceCopyIntegrityException("The evidence metadata has an invalid size or SHA-256.");
        // Refuse symlinks/reparse points, including source ancestors. Never follow them outside the chosen root.
        for (string? path = Path.Combine(root, key); path is not null; path = Path.GetDirectoryName(path))
            if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
                throw new EvidenceCopyIntegrityException("The local evidence source contains a symbolic link or reparse point.");

        await using var original = await source.OpenReadAsync(key, ct)
            ?? throw new EvidenceCopyIntegrityException("A database-referenced local image is missing.");
        await VerifyAsync(original, sizeBytes, sha256, "Local source", ct);
        await using (var existing = await destination.OpenReadAsync(key, ct))
        {
            if (existing is not null)
            {
                await VerifyAsync(existing, sizeBytes, sha256, "Existing S3 object", ct);
                return false;
            }
        }
        if (!apply) return true;

        original.Position = 0;
        // The destination adapter uses atomic create-only writes, even when another copy races this one.
        await destination.PutAsync(key, original, ct);
        await using var uploaded = await destination.OpenReadAsync(key, ct)
            ?? throw new EvidenceCopyIntegrityException("The copied S3 object could not be retrieved.");
        await VerifyAsync(uploaded, sizeBytes, sha256, "Copied S3 object", ct);
        return true;
    }

    private static async Task VerifyAsync(Stream stream, long expectedSize, string expectedHash, string location, CancellationToken ct)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        var buffer = new byte[81920];
        long size = 0;
        int read;
        while ((read = await stream.ReadAsync(buffer, ct)) != 0)
        {
            size = checked(size + read);
            if (size > expectedSize) throw new EvidenceCopyIntegrityException($"{location} does not match its database size.");
            hash.AppendData(buffer, 0, read);
        }
        if (size != expectedSize || Convert.ToHexStringLower(hash.GetHashAndReset()) != expectedHash)
            throw new EvidenceCopyIntegrityException($"{location} does not match its database size and SHA-256.");
    }
}
