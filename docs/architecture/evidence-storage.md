# Evidence object storage

October 15, 2026 — owner requested S3-compatible storage and recommends RustFS
for self-hosting. The subsequent compatibility clarification keeps `Local` when
nothing is configured; deployments deliberately opt into S3.

## Scope and guarantees

Saved-Play captures and uploaded original images are the application's stored
files today. All of them use `IEvidenceObjectStore`; notes, vector markup, hashes
and ownership remain in PostgreSQL. Draft images remain in browser memory.
Credential key-ring files are **not** evidence: keep them on their separate
server-only secret mount, never in the object bucket or database.

- `Local` is the backward-compatible configuration default at the original
  `data/evidence` root. `Provider=S3` explicitly opts into S3; credentials alone
  do not select it. Unknown
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

See `backend/README.md` for configuration keys. `deploy/compose.yaml` explicitly selects
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

**Nothing moves automatically.** An unconfigured API continues using the old
local root. For the S3-oriented Compose example, initially keep
`compose.storage-local.yaml` on every Compose command: it mounts the original
`evidence` volume under the original path. Preserve the Compose project name so
it is the same volume.

1. Stop web/API writers. Back up the database, the complete local evidence root,
   operator settings and the separate credential ring. Keep the originals.
2. Provision a **private** S3 bucket, preferably empty. Configure the destination
   `Vessel__Evidence__Storage__S3__*` and `ConnectionStrings__Vessel` in the
   one-shot command's server environment. The active API may remain `Local`;
   the command targets S3 without persisting that choice. It does not load the
   repository `.env` automatically. Use a newly built API containing this command.
3. Dry-run the offline copy using the **absolute original evidence root**, not
   RustFS's internal `/data` directory:

   ```sh
   dotnet Vessel.Api.dll evidence-copy-to-s3 --source /private/evidence-root
   ```

   The database is read in a **read-only repeatable-read transaction**, across
   all owners as an offline administrator operation. Every referenced file must
   exist and match its recorded size/SHA-256. Existing destination objects must
   match too. No files are uploaded during a dry run. Inspect the reported image
   count/byte total against the backed-up installation before proceeding.
4. Apply, then rerun the dry run:

   ```sh
   dotnet Vessel.Api.dll evidence-copy-to-s3 --source /private/evidence-root --apply
   dotnet Vessel.Api.dll evidence-copy-to-s3 --source /private/evidence-root
   ```

   This preserves complete relative `owner/play/image.ext` keys and downloads
   each newly copied object to verify its size and SHA-256, not its ETag.
   A repeat run verifies/skips identical objects; a different existing object
   stops the run and is **never overwritten**. Missing files, source corruption,
   symlinks/reparse points (including ancestors), invalid keys and S3 failures
   stop it. Unreferenced/orphan files are deliberately not copied.

   Exit 0 means the complete read succeeded, 2 is invalid configuration/usage,
   1 is an operation/integrity failure, and 130 is cancellation. A failed or
   interrupted run may leave copies, but never deletes originals or rolls back
   by deleting destination objects. Resolve the failure and rerun; **do not
   switch providers after a failure**.
5. Explicitly configure the API's `Provider=S3` and start API/web. Check authenticated image reads, notes/markup
   and a new upload/delete. No schema migration or key rewrite is needed.
6. Keep the old root and the coordinated backup until cutover is verified. After
   new uploads, switching back to `Local` requires copying those new objects
   back, or restoring the matching pre-cutover database/storage pair; changing
   only the provider would hide those files.

Reverse migration follows the same rules: stop writers, copy object bytes to the
same relative paths, verify hashes, select `Local`, then restart. Never treat
RustFS's `/data` layout as ordinary image files; use the S3 API to migrate bytes.
An offline full-volume RustFS backup is for restoring the same storage engine,
not copying into `Local` or another vendor.

The command never rewrites database records, changes the saved provider,
deletes local files, creates buckets or starts the API. Use GetObject/PutObject
permissions for its dedicated destination credentials and a SELECT-capable
database principal; listing, deletion and schema-changing permissions are not
required. Prefer a read-only source mount/snapshot where available. The S3
provider must support atomic conditional PUTs.
Run against a trusted, quiescent source (preferably a read-only snapshot).
Symlink checks are pre-open checks, not atomic filesystem confinement. Keep
all writers stopped until cutover completes; hash verification is point-in-time.

## Verification and primary references

- Unit tests cover legacy Local defaults, explicit S3 selection, safe validation,
  conditional writes, key rejection, stream ownership and missing-object/error
  distinctions, plus offline dry-run/copy/resume, integrity failures and symlinks.
- `python3 scripts/verify-evidence-storage.py` creates an isolated RustFS
  container, random credentials and test buckets. It checks the actual SDK
  protocol, concurrent no-overwrite writes, cancellation, private reads, missing
  buckets, API authorization, upload/download/delete and idempotent provisioning.
  It never reads the repository `.env` or owner's database. Set `DOTNET` when
  the pinned SDK is installed outside PATH.
- `python3 scripts/verify-release.py` verifies the default RustFS deployment and
  a fresh-volume offline restore; `--storage local` exercises the retained folder
  deployment/restore instead.

Initial S3 implementation verification on October 15: 1,646 backend tests passed (128 opt-in/environment-dependent
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
