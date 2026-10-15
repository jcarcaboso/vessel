# S3 picture round-trip verification

October 15, 2026 — requested Sol verification and actual picture save/retrieval.

## Real application and browser check

Used newly built production API/web images with a **disposable** PostgreSQL
database, private RustFS and synthetic account/Play/login. No owner `.env`,
database, credentials, existing files or live deployment were used.

1. Opened the application through the native T3 browser, authenticated and opened
   a saved synthetic manual Play.
2. Uploaded three valid images through the Evidence file input, added notes and
   clicked **Save**. Added a text mark to the PNG and saved again.
3. Retrieved the original bytes through the authenticated API. Verified exact
   size, content type, SHA-256, no-store headers and anonymous HTTP 401 for every
   image. Listed the private RustFS bucket and matched the generated keys/sizes.
4. Stopped and restarted **both API and RustFS**, preserving their volumes.
   Repeated the API/object-inventory checks.
5. Fully reloaded the browser and authenticated again, discarding session blobs.
   Reopened the saved Play: all images decoded at their original dimensions,
   notes remained, and the PNG's `S3 verified` mark remained.
6. Used the normal browser **Download original**/image-download controls for all
   three formats. Compared downloaded files directly with the source bytes,
   not just metadata or S3 ETags. Every comparison and SHA-256 matched.
7. Removed the disposable containers, databases, volumes and tagged test images.

| Format | Decoded dimensions | Bytes | Browser download after restart |
| --- | --- | ---: | --- |
| PNG | 320 × 180 | 1,394 | Exact original |
| JPEG | 1440 × 1056 | 150,523 | Exact original |
| WebP | 320 × 180 | 906 | Exact original |

The PNG/WebP are generated test patterns. The JPEG is the existing synthetic
`prototype/assets/previews/graphite.jpg`, not an owner's financial screenshot.
The stack also retained the release check's 1×1 PNG and its box markup.

Full hashes and check flags are in `picture-round-trips.json`.
`png-after-restart.png` captures the recovered image, note and markup after a
fresh browser session.

## Sol reviews and regression checks

- Independent backend Sol review: no concrete findings; **49** S3/evidence/API/
  markup tests and **38** auth/ownership/safe-diagnostic tests passed.
- Independent deployment Sol review: **104** local-folder release checks passed
  (44 HTTP, 47 TLS, 5 image, 8 restore), including a fresh-volume restore of
  original image bytes, notes, markup and the credential ring. Default/local/
  external Compose variants, with credentials and with/without TLS, passed.
- Follow-up Sol reviews identified related test-isolation gaps: direct colon
  settings, .NET host-prefixed settings and special `*CONNSTR_` aliases could
  survive caller-environment filtering. These are now normalized and removed by
  the shared filter used by both verifiers. Host bootstrap overrides cannot
  select the caller's appsettings directory either; ordinary SDK/Docker runtime
  variables remain available. The frontend environment filter also drops the
  connection-string aliases.
- Added regressions for these cases: **26 Python tests passed**. The real
  RustFS/S3 suite passed **22 checks** with hostile synthetic credentials-path,
  database, endpoint, host-content-root and Compose-profile variables injected.
  No real credential file or database was used for these adversarial checks.
- Final Sol follow-up: **no remaining actionable findings** in the reviewed
  paths. It verified 324 alias, 306 mixed-separator and 90 host/Compose/cloud
  variants, all eight release-verifier combinations, and the storage verifier's
  success/failure cleanup paths without contacting any owner service.

Reproducible automated entry points:

```sh
python3 -m unittest discover -s scripts -p 'test_*.py'
DOTNET=/path/to/pinned/dotnet python3 scripts/verify-evidence-storage.py
python3 scripts/verify-release.py
python3 scripts/verify-release.py --storage local
```

The browser steps above were exercised manually through T3's native automation;
the JSON and screenshot record that run, not a standalone browser-test script.
Deployment still requires a newly built/published API image with the S3 adapter;
old published images are not upgraded by editing Compose.

## Compatibility clarification and local-to-S3 copy follow-up

Later on October 15, the owner clarified that **no storage configuration must
retain the original Local default**. S3 is an explicit opt-in; the RustFS Compose
example deliberately selects it. Invalid explicit S3 configuration and outages
still fail rather than silently writing to Local.

Added the offline `evidence-copy-to-s3 --source /absolute/root [--apply]` API
command. It defaults to a dry run, reads evidence metadata in a read-only
repeatable-read transaction and verifies source/downloaded size and SHA-256.
It never deletes local originals, rewrites metadata/notes/markup, runs schema
migrations or saves a provider change.

The automated `S3EvidenceCopyTests` test ran the **actual API executable as a
subprocess**, using a disposable PostgreSQL schema, private RustFS bucket and
the same valid PNG/JPEG/WebP bytes/hashes recorded above:

1. Seeded synthetic evidence metadata/notes/markup and an original local folder.
2. Dry-run succeeded and left the bucket empty.
3. Applied the copy; every downloaded S3 object and authenticated API image
   response matched the original bytes. Anonymous reads still returned 401.
4. Repeated the command: all three objects verified and skipped.
5. Introduced a same-size destination hash mismatch: command failed without
   overwriting it. Removed one local source: command failed without changing
   database records or the other local/destination originals.
6. Verified all metadata/notes/markup and retained original bytes were unchanged.
   Removed the disposable containers, volumes, schema and test files afterward.

Both the ordinary and hostile-caller-environment runs passed **31 real S3
tests**, including the CLI scenario. Hostile inputs included synthetic database
connection aliases, S3 endpoint/profile paths, host content root and Compose
profiles; neither run contacted those destinations. The CLI subprocess uses an
explicit environment allowlist and has a finite timeout.

Independent Sol backend review found no actionable security/integrity/default
issues and independently passed **27 focused tests** before the final additional
trailing-separator case. Independent Sol operations review found no actionable
deployment/docs/isolation issues, passed **26 Python tests**, and checked the
base/Local/external Compose configurations and source-volume mapping.

Final full backend regression: **1,674 passed, 129 opt-in/environment-dependent
tests skipped**. One intermediate run returned a disposed-host error in the
invalid venue-host startup assertion instead of its expected validation text;
the focused reproduction (23 tests) and final full run passed. The API keeps its
original synchronous host entrypoint; only the explicit CLI branch waits for the
asynchronous copy operation.
The backend Sol reviewer also inspected the final path-normalization and
synchronous-entrypoint deltas and found no new issues; no causal claim is made
about the intermediate startup assertion.

Operational limits remain explicit: stop all writers through cutover and use
a trusted, quiescent source/read-only snapshot. Filesystem checks are not atomic
confinement. Conditional-upload races fail closed; rerun to verify/skip the
winner. Keep the originals and coordinated backups after verification.
