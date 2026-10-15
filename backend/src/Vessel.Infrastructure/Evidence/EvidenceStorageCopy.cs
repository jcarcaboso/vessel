using System.Security.Cryptography;
using Vessel.Application.Evidence;

namespace Vessel.Infrastructure.Evidence;

public sealed class EvidenceCopyIntegrityException(string message) : IOException(message);

/// <summary>Offline, metadata-verified copy. Never deletes originals or changes the active provider.</summary>
public sealed class EvidenceStorageCopy
{
    private readonly string? localSourceRoot;
    private readonly string? localDestinationRoot;
    private readonly IEvidenceObjectStore source;
    private readonly IEvidenceObjectStore destination;

    public EvidenceStorageCopy(string sourceRoot, IEvidenceObjectStore destination)
    {
        localSourceRoot = LocalRoot(sourceRoot);
        if (!Directory.Exists(localSourceRoot)) throw new DirectoryNotFoundException("The evidence source directory is missing.");
        source = new LocalEvidenceObjectStore(localSourceRoot);
        this.destination = destination;
    }

    public EvidenceStorageCopy(IEvidenceObjectStore source, string destinationRoot)
    {
        this.source = source;
        localDestinationRoot = LocalRoot(destinationRoot);
        destination = new LocalEvidenceObjectStore(localDestinationRoot);
    }

    /// <returns>True when the object was copied (or would be copied in a dry run); false when it already matches.</returns>
    public async Task<bool> CopyAsync(string key, long sizeBytes, string sha256, bool apply, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        EvidenceObjectKey.Validate(key);
        if (sizeBytes <= 0 || sha256.Length != 64 || sha256.Any(c => c is not (>= '0' and <= '9' or >= 'a' and <= 'f')))
            throw new EvidenceCopyIntegrityException("The evidence metadata has an invalid size or SHA-256.");
        if (localSourceRoot is not null) RejectLinks(Path.Combine(localSourceRoot, key), allowMissing: false);
        if (localDestinationRoot is not null) RejectLinks(Path.Combine(localDestinationRoot, key), allowMissing: true);

        await using var original = await source.OpenReadAsync(key, ct)
            ?? throw new EvidenceCopyIntegrityException("A database-referenced source image is missing.");
        // S3 response streams are not seekable. Stage one image privately, not the entire collection
        // in memory, so a bad source never becomes a final destination file. Dry runs create no files.
        await using var staged = apply && !original.CanSeek ? PrivateStagingFile() : null;
        await VerifyAsync(original, sizeBytes, sha256, "Source image", ct, staged);
        await using (var existing = await destination.OpenReadAsync(key, ct))
        {
            if (existing is not null)
            {
                await VerifyAsync(existing, sizeBytes, sha256, "Existing destination image", ct);
                return false;
            }
        }
        if (!apply) return true;

        var content = (Stream?)staged ?? original;
        content.Position = 0;
        if (localDestinationRoot is not null) RejectLinks(Path.Combine(localDestinationRoot, key), allowMissing: true);
        // The destination adapter uses atomic create-only writes, even when another copy races this one.
        await destination.PutAsync(key, content, ct);
        if (localDestinationRoot is not null) RejectLinks(Path.Combine(localDestinationRoot, key), allowMissing: false);
        await using var uploaded = await destination.OpenReadAsync(key, ct)
            ?? throw new EvidenceCopyIntegrityException("The copied destination image could not be retrieved.");
        await VerifyAsync(uploaded, sizeBytes, sha256, "Copied destination image", ct);
        return true;
    }

    private static string LocalRoot(string root)
    {
        if (!Path.IsPathFullyQualified(root))
            throw new ArgumentException("The local evidence root must be an absolute directory.");
        root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(root));
        RejectLinks(root, allowMissing: true);
        return root;
    }

    private static FileStream PrivateStagingFile()
    {
        var options = new FileStreamOptions
        {
            Mode = FileMode.CreateNew, Access = FileAccess.ReadWrite, Share = FileShare.None,
            Options = FileOptions.Asynchronous | FileOptions.DeleteOnClose | FileOptions.SequentialScan
        };
        if (!OperatingSystem.IsWindows()) options.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;
        return new FileStream(Path.Combine(Path.GetTempPath(), $"vessel-evidence-copy-{Guid.NewGuid():N}.tmp"), options);
    }

    private static void RejectLinks(string path, bool allowMissing)
    {
        // Pre-open checks only: operators must keep these directories trusted and quiescent.
        for (string? current = path; current is not null; current = Path.GetDirectoryName(current))
        {
            try
            {
                if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                    throw new EvidenceCopyIntegrityException("The local evidence path contains a symbolic link or reparse point.");
            }
            catch (IOException error) when (allowMissing && error is FileNotFoundException or DirectoryNotFoundException) { }
        }
    }

    private static async Task VerifyAsync(Stream stream, long expectedSize, string expectedHash, string location,
        CancellationToken ct, Stream? staged = null)
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
            if (staged is not null) await staged.WriteAsync(buffer.AsMemory(0, read), ct);
        }
        if (size != expectedSize || Convert.ToHexStringLower(hash.GetHashAndReset()) != expectedHash)
            throw new EvidenceCopyIntegrityException($"{location} does not match its database size and SHA-256.");
    }
}
