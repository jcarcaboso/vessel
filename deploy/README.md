# Deploy with Docker

Vessel v0.1.1 is a self-hosted, single-owner trading diary. These examples use the
API and web images in one Docker Hub repository:

- `skorcius/vessel:api-0.1.1` and `skorcius/vessel:api-latest`
- `skorcius/vessel:web-0.1.1` and `skorcius/vessel:web-latest`

Use versioned tags for deployments. The `latest` tags move when the owner
publishes another release. Packaging does not publish any image automatically.
This release targets Linux amd64.

For subsequent releases, follow the repository-local
[`vessel-release` skill](../.agents/skills/vessel-release/SKILL.md). Publication
to Docker Hub remains manual: delivering a release includes the agent pushing
and verifying both versioned images, then both moving latest tags. Only explicit
prepare-only, local-only or no-push requests leave images unpublished. Publishing
never upgrades an installation.

## Requirements

Install Docker Engine with Docker Compose 2.24.4 or newer on a Linux amd64 host, OpenSSL,
`uuidgen` and Python 3. Provide persistent disk space for PostgreSQL and evidence
images, plus a DNS name for remote TLS use. The optional TLS overlay supplies Caddy.
The optional credential-key helper needs a source checkout.

Copy this `deploy/` directory to a private operator directory outside the source
checkout. Do not reuse the development `.env`, database or LAN preview services.
In default HTTP mode only web publishes a port. In the TLS overlay only Caddy
publishes ports. PostgreSQL and API have no host ports.

## Configure an installation

From the operator directory:

```sh
umask 077
cp .env.example .env
chmod 600 .env
```

Generate the database password and Vessel login token directly into that private
file. This example runs `openssl rand` and `uuidgen` with captured output rather
than printing secrets to the terminal or shared logs. Do not enable shell tracing
or record environment dumps.

```sh
python3 - <<'PY'
import os
import pathlib
import subprocess

path = pathlib.Path(".env")
text = path.read_text()
replacements = {
    "REPLACE_WITH_GENERATED_HEX_PASSWORD":
        subprocess.check_output(["openssl", "rand", "-hex", "32"], text=True).strip(),
    "REPLACE_WITH_GENERATED_TOKEN":
        subprocess.check_output(["openssl", "rand", "-hex", "48"], text=True).strip(),
    "REPLACE_WITH_GENERATED_GUID":
        subprocess.check_output(["uuidgen"], text=True).strip(),
}
for placeholder, value in replacements.items():
    if text.count(placeholder) != 1:
        raise SystemExit("Expected an unconfigured .env.example copy; nothing written.")
    text = text.replace(placeholder, value)
path.write_text(text)
os.chmod(path, 0o600)
PY
```

Keep the password hexadecimal. Compose inserts it into an Npgsql connection
string, so a custom password must not contain connection-string delimiters.
Set `Vessel__Auth__OwnerName` if desired. Keep the generated owner GUID for the
life of this installation. Changing it hides existing owner-scoped records.

`VESSEL_WEB_BIND` defaults to `127.0.0.1:8080`. Keep it loopback-only, or restrict
it to a private interface reachable only by your TLS proxy. Never expose plain
HTTP to the internet. Choose another port if 8080 is already used.

The Compose network is pinned to `172.30.86.0/24` with gateway `172.30.86.1`.
Web is pinned to `172.30.86.10`; optional Caddy is pinned to `172.30.86.20`.
If these overlap a host, VPN or Docker network, change `VESSEL_NETWORK_SUBNET`,
`VESSEL_NETWORK_GATEWAY`, `VESSEL_WEB_IP` and `VESSEL_TLS_PROXY_IP` together.
Keep both service IPs inside the subnet and distinct from its gateway.

## Optional Lighter credential storage

Public venue reads do not require a key ring. Saving a verified Lighter `ro:`
token does. Keep the ring outside the database and outside all repositories.
For a new installation only, use the existing helper from the source checkout:

```sh
install -d -m 700 "$HOME/.config/vessel-secrets"
python3 /absolute/path/to/vessel/scripts/credential_keys.py init \
  --key-file "$HOME/.config/vessel-secrets/credential-keys.json" \
  --new-installation
sudo chown 1654:1654 "$HOME/.config/vessel-secrets/credential-keys.json"
sudo chmod 600 "$HOME/.config/vessel-secrets/credential-keys.json"
```

Set `VESSEL_CREDENTIAL_KEYS_FILE` in the operator `.env` to that expanded absolute
host path, then include the optional override on **every** Compose command:

```sh
docker compose -f compose.yaml -f compose.credentials.yaml up -d
```

The override mounts the file read-only at
`/run/secrets/vessel-credential-keys.json` and sets
`Vessel__Credentials__KeyFile`. The API runs as `app`, UID 1654. Its loader
requires a regular, non-symlink file with exactly mode `0600`, readable by that
user. The loader checks mode and readability, not ownership separately. On
rootful Docker without user namespace remapping, host UID 1654 is required to
make a `0600` bind mount readable. With rootless Docker or user namespace
remapping, use the corresponding mapped host UID.

Local Compose file-backed secrets do not reliably implement their `uid`, `gid`
and `mode` declarations. This example uses a bind mount with
`create_host_path: false`, not a default `0444` Compose secret. Do not loosen the
loader's permission check. For another deployment system's secret, make sure the
mounted file is `0600` and readable by UID 1654.

The helper initially owns the file as the invoking host user; after changing
ownership, future helper operations must run as the file's host owner in an
owned mode-700 directory. Provision a replacement securely and remount it for
rotation rather than modifying the read-only container file.
Restore existing key IDs and bytes if encrypted credentials already exist.
Never generate a replacement for a lost existing ring. See
[credential setup and rotation](../docs/architecture/venue-credentials.md).

## Optional venue hosts

The API reads each venue's host from `Vessel:Venues`. The defaults are the
production hosts, so most installations set nothing. To point a venue at a
different host, for example an egress proxy, add the matching variable to the
`api` service's `environment` in your own Compose override file and include it
on every Compose command. The example `compose.yaml` does not forward these
from `.env`, and an empty value is invalid rather than a default.

| Variable | Default |
| --- | --- |
| `Vessel__Venues__Hyperliquid__BaseUrl` | `https://api.hyperliquid.xyz/` |
| `Vessel__Venues__Hyperliquid__StreamUrl` | `wss://api.hyperliquid.xyz/ws` |
| `Vessel__Venues__Risex__BaseUrl` | `https://api.rise.trade/` |
| `Vessel__Venues__Lighter__BaseUrl` | `https://mainnet.zklighter.elliot.ai/` |
| `Vessel__Venues__LighterRh__BaseUrl` | `https://api.rh.lighter.xyz/` |

Base URLs must be `https://` origins with no path. Stream URLs must be `wss://`.
Neither may contain user info, a query or a fragment. The API refuses to start
with an invalid value and names only the key, never the value. A host receives
the venue's read-only tokens, so configure only hosts you trust as much as the
venue itself.

## Start and connect

Without optional credential storage:

```sh
docker compose up -d
docker compose ps -a
```

Compose waits for healthy PostgreSQL, runs `/app/migrate` as a deliberate one-shot
step, then starts API and waits for readiness before starting web. The migration
bundle reads `ConnectionStrings__Vessel` from its environment through the
design-time factory. The password is not an argument and the bundle does not
print it. The API never applies migrations at startup.

Open your HTTPS URL and connect with the configured Vessel API token from your
private operator file. Do not confuse it with a Lighter read-only token. Vessel
keeps this login token only in browser session memory, not local storage or URLs.

## HTTPS and proxy trust

### Default HTTP mode

Web overwrites `X-Forwarded-For` with its observed client address and
`X-Forwarded-Proto` with its own HTTP scheme. It clears `X-Forwarded-Host` and
`Forwarded`. `VESSEL_TRUSTED_PROXY` is empty, so no caller can claim HTTPS or
choose another rate-limiter address by supplying these headers. Docker NAT may
make different clients share the gateway address and therefore the failure
limiter. This is conservative, not an identity guarantee.

The API trusts only the pinned `VESSEL_WEB_IP`, with `ForwardLimit=1`, not the
bridge subnet or gateway. PostgreSQL and API are unpublished. Plain HTTP remains
unsuitable for credentials and login tokens beyond a secured local host. The
production Lighter credential guard stays enabled.

### Preferred TLS mode, Caddy in Compose

Set these in the private operator `.env`:

```text
VESSEL_TLS_HOST=vessel.example.com
VESSEL_TLS_HTTP_BIND=0.0.0.0:80
VESSEL_TLS_HTTPS_BIND=0.0.0.0:443
VESSEL_TLS_DIRECTIVE=
```

Point DNS to the host and permit inbound 80/443 for Caddy's public certificates.
Use the overlay on every command, and include the credential override when needed:

```sh
docker compose -f compose.yaml -f compose.tls.yaml up -d
docker compose -f compose.yaml -f compose.tls.yaml ps -a
# With optional credential storage:
docker compose -f compose.yaml -f compose.tls.yaml -f compose.credentials.yaml up -d
```

The overlay resets web's published ports to an empty list. Only Caddy publishes
HTTP/HTTPS. Caddy replaces untrusted forwarded headers and terminates TLS. Nginx
trusts exactly Caddy's pinned IPv4 address through `set_real_ip_from`,
`real_ip_header X-Forwarded-For` and `real_ip_recursive off`. A `geo`/`map` checks
`$realip_remote_addr`, the **immediate** peer before real-IP replacement, before
accepting its scheme. Other peers get their observed address and `$scheme`, even
when they can reach web on the private network. Nginx sends one sanitized hop to
the API, preserving Caddy's observed client IP and HTTPS. The unprivileged nginx
image must include `--with-http_realip_module`; the local verification checks it.
Do not attach untrusted containers or publish web/API in this mode. A container
controlling Caddy's exact IP is a trusted proxy and can impersonate clients.

For an isolated local test, use `VESSEL_TLS_HOST=localhost`, loopback-only free
ports and `VESSEL_TLS_DIRECTIVE=tls internal`. Test with `curl -k`, or install the
local CA in your test browser. Never use `-k` for production credentials. The
`caddy_data` volume contains certificates and private keys; protect it.

### Host-local TLS proxy, weaker alternative

Keep `VESSEL_WEB_BIND=127.0.0.1:8080`, omit the TLS overlay, and explicitly set
`VESSEL_TRUSTED_PROXY=172.30.86.1`, or the actual gateway seen by nginx. Configure
the host proxy with trusted certificates, the same upload limit and unbuffered
SSE. For example:

```nginx
server {
    listen 443 ssl;
    server_name vessel.example.com;
    ssl_certificate /etc/ssl/vessel/fullchain.pem;
    ssl_certificate_key /etc/ssl/vessel/privkey.pem;
    client_max_body_size 10551296;
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host "";
        proxy_set_header Forwarded "";
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_read_timeout 1h;
    }
}
```

**This explicitly trusts every host-local process that can reach the web port.**
Docker NAT gives those processes the same gateway peer as the host TLS proxy.
They can forge HTTPS and client addresses. Loopback binding does not distinguish
processes or encrypt that hop. Use this only on a host where all local processes
are trusted; prefer the unpublished-web overlay. Never combine gateway trust
with a public web binding.

### Other API deployments

Outside this Compose example the API defaults to loopback trust. Nonempty
indexed `Vessel__ForwardedHeaders__KnownNetworks__0` and/or
`Vessel__ForwardedHeaders__KnownProxies__0` settings **replace** loopback defaults.
The API rejects malformed CIDRs, `/0`, unspecified proxies and limits outside
1 to 5. Prefer exact peers and a one-hop chain that sanitizes headers. Every peer
in a configured network can impersonate clients. Never trust a whole bridge
just to make TLS work.

## Web response policy

Static documents, deep-link fallbacks, assets and nginx errors carry `nosniff`,
`DENY`, `no-referrer` and this Content-Security-Policy:

```text
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'
```

Style attributes are needed for theme variables and chart positioning. Scripts
have no inline/eval exception. Blob/data images support captures, uploads and
markup; fonts and API/SSE connections stay same-origin. API responses use their
own security headers, without duplicate nginx headers. Nginx gzip is disabled
for `/api` and `/health`; it passes backend-selected market-data compression
unchanged and compresses static assets only.

## Upgrade

### From v0.1.0 to v0.1.1

This upgrade includes migration `20261013190344_DiaryCompletion`, which adds
manual-execution records and correction history, retrospective Play provenance,
and structured review with amendment history. Back up the database, evidence
and credential key ring before upgrading. Keep web and API stopped while the
explicit migration service runs. The application never migrates at startup.

Venue and architecture changes introduce no additional migration. The new
Lighter · Robinhood venue uses its own accounts and read-only tokens; existing
Lighter accounts and tokens remain separate. Cross-venue supported-stablecoin
totals use nominal 1:1 values, with no FX or depeg valuation.

### Upgrade procedure

Back up first, read the changelog, and set `VESSEL_VERSION` to the chosen release:

```sh
docker compose pull
docker compose stop web api
docker compose up -d
docker compose ps -a
```

`up` restarts the completed migration service and applies any pending migrations
before API starts. Re-running it against the same version is idempotent. Stop web
and API first when a schema change is expected, so no old process uses the schema
while it changes. This
ordering is the explicit deployment migration step, not API startup migration.
Do not use `docker compose restart` to upgrade or apply migrations. Failed
migrations block API startup; inspect the migration logs before proceeding.
Use both `-f` options above when credential storage is configured.
An application downgrade does not roll back the database. Restore backups if a
new schema is incompatible with the old image.

## Backups

Keep backups private and test restores in an isolated installation. Stop web and
API to keep database references and evidence consistent, then:

```sh
umask 077
mkdir -p backups
docker compose stop web api
docker compose exec -T postgres pg_dump -U vessel -d vessel -Fc > backups/vessel.dump
docker compose run --rm --no-deps --entrypoint tar api \
  -C /var/lib/vessel/evidence -czf - . > backups/evidence.tar.gz
docker compose up -d
```

Back up the credential ring **separately**, with restricted permissions and a
separate protected destination. Save the owner GUID and operator settings
privately too. Do not put the keys inside the database or evidence archive.
PostgreSQL 18 stores its data below the named volume mounted at
`/var/lib/postgresql`. Do not copy a live data directory as a substitute for
`pg_dump`. Evidence uses its own named volume at `/var/lib/vessel/evidence`,
writable by the non-root API. Restore both and the same key ring into a
disposable deployment before relying on the procedure. The local release
verification exercises the restore below with synthetic records and evidence.

## Isolated restore

Use a new private operator directory, a unique project name and **fresh** named
volumes, not an existing installation. Copy the deploy files and create a private
`.env` with a new database password, the **same** `Vessel__Auth__OwnerId`, and the
saved operator settings. You may rotate the Vessel login token. Select the image
version that produced the backup first. Bind web to an unused loopback port and
choose an unused subnet and pinned service IPs. Do not start web/API yet.

The examples use the default mode; add every applicable `-f` overlay to each
command. `-p vessel-restore-check` must never name the live project.

```sh
umask 077
# Verify this project does not already exist before creating any volumes.
docker compose -p vessel-restore-check ps -a
docker compose -p vessel-restore-check up -d --wait postgres
# The fresh database is empty. -Fc dumps require pg_restore, not psql.
docker compose -p vessel-restore-check exec -T postgres \
  pg_restore -U vessel -d vessel --no-owner --no-privileges --exit-on-error \
  < /private/backups/vessel.dump
# For a plain SQL dump instead, use:
# docker compose -p vessel-restore-check exec -T postgres \
#   psql -U vessel -d vessel -v ON_ERROR_STOP=1 < /private/backups/vessel.sql

# Extract only your trusted evidence archive. API is stopped; root fixes ownership.
docker compose -p vessel-restore-check run --rm --no-deps -T \
  --user 0 --entrypoint sh api -c \
  'tar -xzf - -C /var/lib/vessel/evidence && chown -R 1654:1654 /var/lib/vessel/evidence' \
  < /private/backups/evidence.tar.gz
```

Place the original credential ring in a separate mode-700 secret directory,
not the operator directory, database or evidence archive. Preserve every original
key ID and byte, including retired keys needed by retained credentials. On rootful
Docker set the file owner to `1654:1654` and mode to `0600`; apply the mapped UID
for rootless/user-namespace deployments. Use a regular, non-symlink file. Set
`VESSEL_CREDENTIAL_KEYS_FILE` to that absolute path and include
`compose.credentials.yaml` on subsequent commands. Generating a new ring cannot
decrypt the restored credentials.

```sh
# This is the explicit migration step after restoring, not API startup.
docker compose -p vessel-restore-check run --rm migrate
docker compose -p vessel-restore-check up -d
docker compose -p vessel-restore-check ps -a
curl --fail http://127.0.0.1:YOUR_UNUSED_PORT/health/live
curl --fail http://127.0.0.1:YOUR_UNUSED_PORT/health/ready
```

Authenticate through the UI with the restored installation's login token. Check
that portfolios/accounts and saved Plays are visible under the unchanged owner,
that an original evidence image and its markup open, and that credential metadata
reports configured storage. Readiness confirms database connectivity/migrations,
not decryption or venue access. To test decryption without exposing tokens, use
an isolated stub venue or the approved read-only refresh against the real venue;
do not print ciphertext, keys or plaintext. The local release check tests ring
placement/startup and exact backup bytes, not a real Lighter token refresh.

After the check, remove **only the disposable project** and its volumes:

```sh
docker compose -p vessel-restore-check down -v
```

## Local release verification

From a source checkout, the scripted check builds throwaway amd64 images and
uses its own temp operator directory, unique project/unused subnet, free loopback ports
and synthetic owner/token. It never reads the repository `.env`, uses the owner's
database, pushes images or calls a registry login. Public image pulls are needed.

```sh
python3 scripts/verify-release.py
# Optional production browser CSP check, using an already available Playwright:
python3 scripts/verify-release.py --browser-module /absolute/path/to/playwright
# When Playwright's default browser is unavailable, set CHROMIUM_PATH to a
# compatible installed Chromium executable before invoking the same check.
```

It checks HTTP and internal-CA TLS trust, spoofed scheme/address handling,
compression, headers, unbuffered SSE via a local fixture, upload limits, unpublished
web in TLS mode and a fresh-volume restore. The fixture replaces only the upstream
for its nginx transport test, not production code. Cleanup runs on success/failure.
The browser check uses synthetic API data and intercepts chart market reads, with
no real venue call. Run frontend/.NET checks separately as in `docs/development.md`.

## Logs and troubleshooting

```sh
docker compose ps -a
docker compose logs --tail=100 migrate api web
curl --fail http://127.0.0.1:8080/health/ready
```

Do not publish operator `.env`, `docker inspect`, `docker compose config`, request
bodies or full environment dumps; they can contain secrets. The API logs safe
failure categories, not raw dependency details.

- `/health/live` only proves the API process responds.
- `/health/ready` returns 200 when PostgreSQL is reachable and there are no pending
  migrations. A 503 reveals no database details. It does not verify venue access.
- If API does not start, check the generated token length, owner GUID, migration
  exit status, database health and optional key-file mode/readability.
- If Lighter reports insecure transport, check HTTPS and trusted proxy addresses.
  Do not switch production to Development to bypass the guard.
- If web returns 502, check API health and `VESSEL_API_UPSTREAM`.
- Uploads allow a 10 MiB image plus 64 KiB multipart overhead. Match this limit in
  the external proxy. API independently validates image size, type and ownership.
- If a different non-Docker deployment mounts an existing evidence directory,
  ensure UID 1654 can write it. Docker initializes a fresh named volume with the
  image directory's ownership.

## Build locally from source

From the repository root, with no populated secret files in the build context:

```sh
REVISION=$(git rev-parse HEAD)
docker build --platform linux/amd64 -f backend/Dockerfile \
  --build-arg VERSION=0.1.1 --build-arg REVISION="$REVISION" \
  -t skorcius/vessel:api-0.1.1 .
docker build --platform linux/amd64 -f frontend/Dockerfile \
  --build-arg VERSION=0.1.1 --build-arg REVISION="$REVISION" \
  -t skorcius/vessel:web-0.1.1 .
```

The API build pins SDK `10.0.302` to match the repository's `global.json`. The
moving `sdk:10.0` tag can contain a different feature band that the SDK pin rejects.
It uses locked NuGet
restore and local EF tool manifest. It includes the migration bundle in the same
runtime image. The web build uses Node 24, Corepack, the pinned pnpm and frozen
workspace lockfile. Neither build needs the database, auth token or key ring.
The root `.dockerignore` applies to both builds. Hashed assets are immutable for
one year; `index.html` and SPA fallbacks use `no-cache`. API data remains
`no-store`, and SSE proxy buffering is off.
