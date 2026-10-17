using System.Net;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Vessel.Application.Evidence;

namespace Vessel.Infrastructure.Evidence;

/// <summary>Private, pre-provisioned bucket. No public URLs, ACLs or bucket administration at runtime.</summary>
public sealed class S3EvidenceObjectStore(IAmazonS3 client, string bucket) : IEvidenceObjectStore
{
    public async Task PutAsync(string key, Stream content, CancellationToken ct)
    {
        EvidenceObjectKey.Validate(key);
        // A 412 from the create-only condition stays the provider's own error; only transient failures are wrapped.
        await Transient(() => client.PutObjectAsync(new PutObjectRequest
        {
            BucketName = bucket,
            Key = key,
            InputStream = content,
            AutoCloseStream = false,
            ContentType = "application/octet-stream",
            // Atomic create-only, not a racy HEAD followed by PUT. Never retry as an unconditional write.
            IfNoneMatch = "*",
            UseChunkEncoding = false
        }, ct), ct);
    }

    public async Task<Stream?> OpenReadAsync(string key, CancellationToken ct)
    {
        EvidenceObjectKey.Validate(key);
        return await Transient(async () =>
        {
            try
            {
                var response = await client.GetObjectAsync(new GetObjectRequest { BucketName = bucket, Key = key }, ct);
                return (Stream?)new ObjectStream(response);
            }
            catch (AmazonS3Exception error) when (error.StatusCode == HttpStatusCode.NotFound && error.ErrorCode == "NoSuchKey")
            {
                // A missing bucket, access failure or outage is not a missing image.
                return null;
            }
        }, ct);
    }

    public async Task DeleteAsync(string key, CancellationToken ct)
    {
        EvidenceObjectKey.Validate(key);
        // S3 DELETE is idempotent even when the key is absent.
        await Transient(() => client.DeleteObjectAsync(new DeleteObjectRequest { BucketName = bucket, Key = key }, ct), ct);
    }

    private static async Task<T> Transient<T>(Func<Task<T>> operation, CancellationToken ct)
    {
        try { return await operation(); }
        catch (Exception error) when (IsTransient(error, ct))
        {
            // The Api knows only this Application type; no AWS detail reaches its message.
            throw new EvidenceStorageUnavailableException(error);
        }
    }

    // Provider codes meaning "slow down or try again", whatever status an S3-compatible service pairs them with.
    private static readonly HashSet<string> RetryLaterCodes = new(StringComparer.Ordinal)
    {
        "SlowDown", "RequestTimeout", "Throttling", "ThrottlingException", "ServiceUnavailable", "InternalError"
    };

    /// <summary>
    /// Transient: the store was unreachable, timed out (not the caller cancelling), throttled the request or reported
    /// a 5xx. Any other provider response (4xx configuration, permission, missing bucket, the 412 create-only
    /// conflict) is not, and neither is caller cancellation.
    /// </summary>
    internal static bool IsTransient(Exception error, CancellationToken ct)
    {
        if (ct.IsCancellationRequested)
            for (var current = error; current is not null; current = current.InnerException)
                if (current is OperationCanceledException) return false;
        for (var current = error; current is not null; current = current.InnerException)
        {
            switch (current)
            {
                // A provider response decides by itself; its inner exceptions are parsing details.
                case AmazonServiceException service when service.StatusCode != 0:
                    var status = (int)service.StatusCode;
                    return status >= 500 || status == 429 ||
                        (status != 412 && service.ErrorCode is { } code && RetryLaterCodes.Contains(code));
                // No response at all: transport failures and SDK/HttpClient timeouts.
                case OperationCanceledException:
                case TimeoutException:
                case System.Net.Sockets.SocketException:
                case HttpRequestException { StatusCode: null }:
                    return true;
                // Transport streams throw the base type; file-system subtypes (and copy integrity failures) are local.
                case IOException when current.GetType() == typeof(IOException):
                    return true;
                case HttpRequestException { StatusCode: { } httpStatus }:
                    return (int)httpStatus >= 500 || (int)httpStatus == 429;
            }
        }
        return false;
    }

    private sealed class ObjectStream(GetObjectResponse response) : Stream
    {
        private Stream Content => response.ResponseStream;
        public override bool CanRead => Content.CanRead;
        public override bool CanSeek => Content.CanSeek;
        public override bool CanWrite => false;
        public override long Length => Content.Length;
        public override long Position { get => Content.Position; set => Content.Position = value; }
        public override int Read(byte[] buffer, int offset, int count) => Content.Read(buffer, offset, count);
        public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken ct) =>
            Content.ReadAsync(buffer, offset, count, ct);
        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken ct = default) => Content.ReadAsync(buffer, ct);
        public override long Seek(long offset, SeekOrigin origin) => Content.Seek(offset, origin);
        public override void Flush() => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        protected override void Dispose(bool disposing)
        {
            if (disposing) response.Dispose();
            base.Dispose(disposing);
        }
    }
}
