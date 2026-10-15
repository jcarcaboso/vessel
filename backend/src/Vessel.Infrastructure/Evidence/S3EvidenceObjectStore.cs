using System.Net;
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
        await client.PutObjectAsync(new PutObjectRequest
        {
            BucketName = bucket,
            Key = key,
            InputStream = content,
            AutoCloseStream = false,
            ContentType = "application/octet-stream",
            // Atomic create-only, not a racy HEAD followed by PUT. Never retry as an unconditional write.
            IfNoneMatch = "*",
            UseChunkEncoding = false
        }, ct);
    }

    public async Task<Stream?> OpenReadAsync(string key, CancellationToken ct)
    {
        EvidenceObjectKey.Validate(key);
        try
        {
            var response = await client.GetObjectAsync(new GetObjectRequest { BucketName = bucket, Key = key }, ct);
            return new ObjectStream(response);
        }
        catch (AmazonS3Exception error) when (error.StatusCode == HttpStatusCode.NotFound && error.ErrorCode == "NoSuchKey")
        {
            // A missing bucket, access failure or outage is not a missing image.
            return null;
        }
    }

    public async Task DeleteAsync(string key, CancellationToken ct)
    {
        EvidenceObjectKey.Validate(key);
        // S3 DELETE is idempotent even when the key is absent.
        await client.DeleteObjectAsync(new DeleteObjectRequest { BucketName = bucket, Key = key }, ct);
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
