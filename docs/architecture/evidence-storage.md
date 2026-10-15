# Evidence object storage

October 15, 2026 — owner requested S3-compatible storage by default, recommending
RustFS for self-hosting while retaining the local-folder option.

## Scope and guarantees

Saved-Play captures and uploaded original images are the application's stored
files today. All of them use `IEvidenceObjectStore`; notes, vector markup, hashes
and ownership remain in PostgreSQL. Draft images remain in browser memory.
Credential key-ring files are **not** evidence: keep them on their separate
server-only secret mount, never in the object bucket or database.

- `S3` is the configuration default; `Local` is an explicit opt-in. Unknown
  providers or incomplete active-provider settings fail startup without printing
  values. There is no silent fallback, dual-write, bucket creation at API startup
  or automatic movement of existing images.
- The AWS .NET S3 SDK handles signing, transport and bounded retries. Endpoint,
  region, bucket and path-style addressing are configurable. Credentials are
  explicit server configuration, not browser settings or URL parameters.
- Both adapters accept the same generated `owner/play/image.ext` keys. S3 uses
  conditional `PutObject` (`If-None-Match: *`) so duplicate/concurrent writes
  cannot replace an original. The local adapter retains its atomic no-overwrite
  rename. Other S3-compatible providers must support conditional writes.
- Only `NoSuchKey` becomes a missing image. Missing buckets, access failures,
  outages and write conflicts fail rather than selecting another store. The
  existing safe API exception handling does not expose S3 response details.
- Reads stream through the authenticated, owner-scoped API; disposing its stream
  disposes the S3 response. There are no public objects, browser S3 requests,
  bucket CORS requirements or presigned links.
- Existing bytes-first/metadata-second upload ordering and compensating deletes
  are unchanged. Failed cleanup can leave an orphan; automatic orphan cleanup
  is still not implemented.

See `backend/README.md` for configuration keys. `deploy/compose.yaml` defaults to
private RustFS **1.0.1**, with its console disabled and no published storage ports.
A separate one-shot AWS CLI service creates the private bucket before API
startup. RustFS and PostgreSQL have separate persistent volumes. External S3
and local-folder overlays omit the embedded service and bucket initializer.
API readiness continues to check PostgreSQL/migrations, **not** object storage;
an authenticated upload/read is the operational storage check.

The simple bundled example uses one credential pair for its dedicated,
single-owner RustFS service and API. Do not share that store with other apps:
the pair is administrative. For a shared/externally operated service, provision
a dedicated private bucket and bucket-scoped API credentials (GetObject,
PutObject, DeleteObject only) using `compose.storage-external.yaml`. Keep
provisioning/backup credentials separate. Use HTTPS for non-private-network
endpoints; do not disable certificate validation.

## Existing local-folder installation: explicit cutover

**Updating the default alone does not move any files.** Initially keep
`compose.storage-local.yaml` on every Compose command (or set provider `Local`
outside Compose). It mounts the original `evidence` volume under the original
path. Preserve the Compose project name so it is the same volume.

1. Stop web/API writers. Back up the database, the complete local evidence root,
   operator settings and the separate credential ring. Keep the originals.
2. Provision an **empty private** S3 bucket. Copy the contents of the evidence
   root to the bucket root, preserving the complete relative paths exactly.
   Do not add an `evidence/` prefix or substitute original client filenames.
   With an S3 client configured via a private credential file/environment:

   ```sh
   aws --endpoint-url https://YOUR_S3_ORIGIN s3 cp /private/evidence-root/ \
     s3://YOUR_EMPTY_BUCKET/ --recursive --no-follow-symlinks
   ```

   Do not run this against a nonempty bucket; a generic S3 copy can overwrite.
   Use S3 listing/GetObject permissions only for the migration/verification tool,
   not as a reason to widen the runtime principal.
3. Verify every database-referenced object exists with the recorded size and
   SHA-256 (download/read back and hash; an S3 ETag is **not** a SHA-256 checksum).
   Check file count and full byte totals too. Do not discard originals on a
   successful copy exit code alone.
4. Configure S3 and start API/web. Check authenticated image reads, notes/markup
   and a new upload/delete. No schema migration or key rewrite is needed.
5. Keep the old root and the coordinated backup until cutover is verified. After
   new uploads, switching back to `Local` requires copying those new objects
   back, or restoring the matching pre-cutover database/storage pair; changing
   only the provider would hide those files.

Reverse migration follows the same rules: stop writers, copy object bytes to the
same relative paths, verify hashes, select `Local`, then restart. Never treat
RustFS's `/data` layout as ordinary image files; use the S3 API to migrate bytes.
An offline full-volume RustFS backup is for restoring the same storage engine,
not copying into `Local` or another vendor.

## Verification and primary references

- Unit tests cover configuration, safe validation, conditional writes, key
  rejection, stream ownership and missing-object/error distinctions.
- `python3 scripts/verify-evidence-storage.py` creates an isolated RustFS
  container, random credentials and test buckets. It checks the actual SDK
  protocol, concurrent no-overwrite writes, cancellation, private reads, missing
  buckets, API authorization, upload/download/delete and idempotent provisioning.
  It never reads the repository `.env` or owner's database. Set `DOTNET` when
  the pinned SDK is installed outside PATH.
- `python3 scripts/verify-release.py` verifies the default RustFS deployment and
  a fresh-volume offline restore; `--storage local` exercises the retained folder
  deployment/restore instead.

Verified October 15: 1,646 backend tests passed (128 opt-in/environment-dependent
tests skipped), all 22 S3 checks passed against disposable RustFS, and 24 Python
tests passed. Both S3 and local release runs passed 104 checks each, including
HTTP/TLS and fresh-volume database/image/markup/key-ring restores. The S3 check
also passed with hostile synthetic caller endpoint/profile overrides, confirming
it uses its own isolated configuration. No owner data or deployment was touched.

The owner's subsequent Sol verification request also exercised actual PNG,
JPEG and WebP browser uploads, API/RustFS restart, fresh-session rendering and
byte-identical browser downloads. Sol findings hardened verifier environment
isolation for .NET separators, host prefixes and connection-string aliases;
26 Python tests and 22 real-S3 checks pass. The final Sol follow-up found no
remaining actionable issues in the reviewed paths. See the
[review and picture evidence](../product-review/verification/2026-10-15-storage/README.md).

Primary sources checked October 15, 2026:

- [RustFS 1.0.1 release](https://github.com/rustfs/rustfs/releases/tag/1.0.1)
- [RustFS image permissions and volumes](https://github.com/rustfs/rustfs/blob/1.0.1/Dockerfile)
- [RustFS Compose configuration/health endpoints](https://github.com/rustfs/rustfs/blob/1.0.1/docker-compose.yml)
- [AWS .NET S3 PutObjectRequest](https://docs.aws.amazon.com/sdkfornet/v4/apidocs/items/S3/TPutObjectRequest.html)
- [S3 conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)
