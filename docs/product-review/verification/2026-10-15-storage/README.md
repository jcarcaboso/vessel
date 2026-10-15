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
