# Deploy with Docker

Vessel v0.1.0 is a self-hosted, single-owner trading diary. These examples use the
API and web images in one Docker Hub repository:

- `skorcius/vessel:api-0.1.0` and `skorcius/vessel:api-latest`
- `skorcius/vessel:web-0.1.0` and `skorcius/vessel:web-latest`

Use versioned tags for deployments. The `latest` tags move when the owner
publishes another release. Packaging does not publish any image automatically.
The first release targets Linux amd64.

## Requirements

Install Docker Engine with Docker Compose v2 on a Linux amd64 host, OpenSSL,
`uuidgen` and Python 3. Provide persistent disk space for PostgreSQL and evidence
images, plus a DNS name and a trusted TLS-terminating proxy for remote use.
The optional credential-key helper needs a source checkout.

Copy this `deploy/` directory to a private operator directory outside the source
checkout. Do not reuse the development `.env`, database or LAN preview services.
Only web publishes a port. PostgreSQL and API have no host ports.

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
If it overlaps a host, VPN or Docker network, change `VESSEL_NETWORK_SUBNET`,
`VESSEL_NETWORK_GATEWAY` and `VESSEL_TLS_PROXY_IP` together.

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

For a host-local nginx TLS proxy, use your own certificate paths and hostname:

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
        # Overwrite untrusted client headers, never append an incoming claim.
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_read_timeout 1h;
    }
}
```

Configure port 80 only to redirect to HTTPS if needed. The web container preserves
the proxy's `X-Forwarded-Proto` and appends its immediate peer to
`X-Forwarded-For`. The API defaults to trusting loopback only. Compose explicitly
adds its private subnet and the host-local proxy IP with a two-hop limit so it
can see both HTTPS and the original client IP for failed-token rate limiting.
`VESSEL_TLS_PROXY_IP` must match the TLS proxy's peer IP as seen by web.

All containers on the configured trusted subnet can claim a scheme and client
address. Do not attach untrusted workloads to it. Trust only proxies that replace
incoming client headers. Direct callers of the loopback web port can also claim
HTTPS, so restrict access to the host and proxy. Lighter token entry requires
HTTPS outside direct loopback; preserving a header is not encryption.

For a custom deployment, use indexed
`Vessel__ForwardedHeaders__KnownNetworks__0` and/or
`Vessel__ForwardedHeaders__KnownProxies__0` environment settings. Empty additional
lists mean no additional trust. The API rejects malformed CIDRs, `/0` networks,
unspecified proxy addresses and hop limits outside 1 to 5. Do not trust an
internet-wide network. Prefer exact proxy IPs where practical.

## Upgrade

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
disposable deployment before relying on the procedure. A restore is not verified
by the release packaging checks.

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
  --build-arg VERSION=0.1.0 --build-arg REVISION="$REVISION" \
  -t skorcius/vessel:api-0.1.0 -t skorcius/vessel:api-latest .
docker build --platform linux/amd64 -f frontend/Dockerfile \
  --build-arg VERSION=0.1.0 --build-arg REVISION="$REVISION" \
  -t skorcius/vessel:web-0.1.0 -t skorcius/vessel:web-latest .
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
