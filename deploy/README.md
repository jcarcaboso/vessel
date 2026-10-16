# Deploy with Docker

Vessel v0.1.3 is a self-hosted, single-owner trading diary. These examples use the
API and web images in one Docker Hub repository:

- `skorcius/vessel:api-0.1.3` and `skorcius/vessel:api-latest`
- `skorcius/vessel:web-0.1.3` and `skorcius/vessel:web-latest`

Use versioned tags for deployments. The `latest` tags move with each release.
This release targets Linux amd64.

Releases are published by the repository's Release workflow when an annotated
`vX.Y.Z` tag is pushed on `main`; see the
[`vessel-release` skill](../.agents/skills/vessel-release/SKILL.md) and the
[release notes](../docs/releases/). Publishing never upgrades an installation.

## Requirements

Install Docker Engine with Docker Compose 2.24.4 or newer on a Linux amd64 host, OpenSSL,
`uuidgen` and Python 3. Provide persistent disk space for PostgreSQL and evidence
images in private RustFS S3-compatible storage and the RabbitMQ volume, plus a DNS
name for remote TLS use. RustFS 1.0.1 is the default; local folders and external S3
remain configurable. This Compose example deliberately sets `Provider=S3`. The API
itself remains backward-compatible: no storage settings means `Local`, not an
automatic S3 choice. The worker never reads evidence storage. The optional TLS
overlay supplies Caddy.
The optional credential-key helper needs a source checkout.

Copy this `deploy/` directory to a private operator directory outside the source
checkout. Do not reuse the development `.env`, database or LAN preview services.
In default HTTP mode only web publishes a port. In the TLS overlay Caddy replaces
that web port. RabbitMQ management is separately published on loopback for
troubleshooting. PostgreSQL, API, worker, AMQP and RustFS have no host ports; the
RustFS console is disabled. **Existing folder installations must select the local
overlay or complete the storage cutover below before switching to the new default.**

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
    "REPLACE_WITH_GENERATED_BROKER_PASSWORD":
        subprocess.check_output(["openssl", "rand", "-hex", "32"], text=True).strip(),
    "REPLACE_WITH_GENERATED_TOKEN":
        subprocess.check_output(["openssl", "rand", "-hex", "48"], text=True).strip(),
    "REPLACE_WITH_GENERATED_GUID":
        subprocess.check_output(["uuidgen"], text=True).strip(),
    "REPLACE_WITH_GENERATED_S3_ACCESS_KEY":
        subprocess.check_output(["openssl", "rand", "-hex", "16"], text=True).strip(),
    "REPLACE_WITH_GENERATED_S3_SECRET_KEY":
        subprocess.check_output(["openssl", "rand", "-hex", "32"], text=True).strip(),
    "REPLACE_WITH_GENERATED_BROKER_PASSWORD":
        subprocess.check_output(["openssl", "rand", "-hex", "32"], text=True).strip(),
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
Keep `RABBITMQ_USER=vessel` or choose a lowercase ASCII username. The broker
password must be hexadecimal because Compose places it in the private AMQP URI.
Never use `guest`, print that URI, or publish AMQP outside the private network.
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

## Event messaging: RabbitMQ

Committed events are recorded in PostgreSQL and relayed after commit through a
durable outbox to RabbitMQ, which is transport, not the record. Compose runs the
pinned `rabbitmq:4.3.6-management` image with the `RABBITMQ_USER`/`RABBITMQ_PASSWORD`
credentials from `.env`, a named `rabbitmq` volume for durable quorum queues and a
`rabbitmq-diagnostics -q ping` healthcheck. AMQP stays on the private Compose
network. The management page binds to `VESSEL_RABBITMQ_MANAGEMENT_BIND`
(default `127.0.0.1:15672`) for troubleshooting; reach it through an SSH tunnel or
an HTTPS proxy, never plain HTTP on the internet.

Publishers write each event once to the topic exchange `vessel.events`, with the
event type as routing key. Each subscriber owns a queue `vessel.events.sub.<name>`
bound by its filter, with a dead-letter exchange and queue `….dlx`/`….dlq` and a
quorum delivery limit of 20 as a transport guard. Account monitor commands use the
point-to-point queue `vessel.commands.monitor`, which the worker's `monitor`
module listens to. This release registers no production event subscription.

The one-shot `migrate` service applies the EF migrations and then runs
`provision-messaging`: Wolverine envelope storage for every logical deployment
(`wolverine_api`, `wolverine_monitor`) with its module set recorded in
`messaging_deployments`, the broker topology of every module and insert-only
subscription registrations. Neither the API nor a worker creates storage or
declares topology at startup. A host whose deployment was not provisioned, or
whose schema was provisioned for a different module set, refuses to start, so no
deployment recovers envelopes it has no route for. To change the modules of an
existing deployment, stop it, let its outbox drain, and provision it under a new
deployment name (and schema) instead of editing the old one.
Administrator commands run in the API image with the server configuration:

```sh
# Mandatory step of every database restore, before provisioning and starting hosts.
docker compose run --rm --no-deps --entrypoint dotnet migrate /app/Vessel.Api.dll rotate-event-epoch
# Return a subscription's failed receipts to pending with a bounded extra budget.
docker compose run --rm --no-deps --entrypoint dotnet migrate /app/Vessel.Api.dll \
  retry-event-receipts <name> --limit 100 --attempts 3
# Remove a subscription's registration, receipts and queue.
docker compose run --rm --no-deps --entrypoint dotnet migrate /app/Vessel.Api.dll \
  deregister-event-subscription <name>
```

A release check can set `Vessel__Messaging__Verification=true` on `migrate` to
register the `verification` subscription, prove delivery from its receipts and
then deregister it. Dead-letter queues are diagnostic copies; redriving one never
reopens a settled receipt.

## Image storage: RustFS by default

The default Compose file starts private RustFS, waits for its health check and
runs `storage-init` once to create `VESSEL_S3_BUCKET` (default `vessel-evidence`).
API startup waits for successful initialization as well as migrations. Re-running
initialization does not erase the bucket. Original images live in the `objects`
volume; notes, markup and ownership stay in PostgreSQL. All image access passes
through the authenticated Vessel API; do not enable public bucket policies or CORS.

Generate the S3 credentials above, keep `.env` private and retain the same pair
across restarts/restores. The bundled, dedicated single-owner RustFS uses that
pair for both administration and API access. For a shared object store, use a
separate private bucket and bucket-scoped runtime credentials with the external
option below; do not reuse an administrator key from another installation.
Vessel's venue credential ring stays on its separate secret mount, never in S3.

### Existing/external S3-compatible service

Provision a private bucket separately and set `VESSEL_S3_ENDPOINT` (an HTTPS
origin, without path/query/credentials), `VESSEL_S3_BUCKET`, `VESSEL_S3_REGION`,
`VESSEL_S3_ACCESS_KEY_ID` and `VESSEL_S3_SECRET_ACCESS_KEY`. Set
`VESSEL_S3_FORCE_PATH_STYLE=false` if the provider requires virtual-host addressing.
Grant the API only `s3:GetObject`, `s3:PutObject` and `s3:DeleteObject` on that
bucket's objects. Keep list/create/backup privileges with the operator.
For offline **destination-copy** credentials on AWS S3, additionally grant
`s3:ListBucket` on that destination bucket (not its object ARN). The helper
does not list objects, but needs AWS to return 404 for an absent key rather
than an indistinguishable 403 access failure. Use this separate operator role
for copy commands; do not broaden the running API role.

```sh
docker compose -f compose.yaml -f compose.storage-external.yaml up -d
```

This omits the bundled RustFS and initializer. API startup validates configuration
but does not provision or probe an external bucket. The provider must support
atomic conditional PUT (`If-None-Match: *`); never weaken this to allow overwrites.
Use the provider's backup/restore process, not the RustFS volume commands below.

### Local folder / preserving an existing installation

```sh
docker compose -f compose.yaml -f compose.storage-local.yaml up -d
```

This selects `Local`, omits RustFS/initialization and retains the original
`evidence:/var/lib/vessel/evidence` volume. S3 credentials are not needed. Keep the
same Compose project name to reuse existing data. Outside Docker, no provider
setting is needed for Local; optionally set
`Vessel__Evidence__Storage__Local__RootPath`.

Include your selected storage overlay on **every** Compose command, together
with TLS/credential overlays when used. Do not enable the internal
`unused-storage` profile. Local and external overlays are alternatives.

Changing provider does **not** move existing files. Stop writers, copy every
original with its existing `owner/play/image.ext` key and verify sizes/SHA-256
before switching; see [the cutover checklist](../docs/architecture/evidence-storage.md).
No database migration is needed. These changes require a newly built/published
API image containing the S3 adapter; API images without this adapter support
only local storage. Do not apply the new Compose default to an old image.

### Copy existing local images to S3

This is an explicit offline file copy, **not a schema migration or automatic
startup task**. Keep the same Compose project name, take coordinated backups and
select a newly built API image containing the copy command. Stop all web/API
writers; PostgreSQL must remain available. Add your usual TLS/key overlays to the
commands as appropriate.

For the bundled RustFS destination, provision it without starting API/web:

```sh
docker compose -f compose.yaml -f compose.storage-local.yaml stop web api
docker compose -f compose.yaml up -d --wait rustfs
docker compose -f compose.yaml run --rm --no-deps storage-init
```

For external S3, provision the private bucket separately and configure its
`VESSEL_S3_*` settings instead of starting RustFS. Then run against the **original
local volume**, which the local overlay mounts at the unchanged path:

```sh
# Dry run: checks every database-referenced original; does not upload.
docker compose -f compose.yaml -f compose.storage-local.yaml run --rm --no-deps \
  api evidence-copy-to-s3 --source /var/lib/vessel/evidence

# Only after a successful dry run and reviewing the reported count/byte total:
docker compose -f compose.yaml -f compose.storage-local.yaml run --rm --no-deps \
  api evidence-copy-to-s3 --source /var/lib/vessel/evidence --apply
```

`--no-deps` prevents this operation from running the schema migrator or starting
other services. The command temporarily targets S3 while the local overlay keeps
the normal API on Local. It verifies each source against database size/SHA-256,
uses create-only uploads, downloads/verifies the result and skips matching
objects on reruns. It never deletes originals, changes notes/markup/database
records or saves a provider switch. Different destination contents stop the run.
After any failure, resolve it and rerun; do not cut over on partial success.

Rerun the dry run to verify all objects already match. Then explicitly remove the
local overlay (use the external overlay for external S3) and restart API/web.
Keep the original volume and backups until authenticated image reads, notes/markup
and a new upload are verified. See the [complete cutover and rollback checklist](../docs/architecture/evidence-storage.md#existing-local-folder-installation-explicit-cutover).

### Export S3 to Local or switch S3 providers

Use an API image containing `evidence-copy-to-local`; older published images do
not gain this command from a Compose update. Stop web/API writers and take
coordinated backups, but leave PostgreSQL and the source S3 running. Preserve
the project name and installation overlays on every command below (add
`-f compose.storage-external.yaml` when the source is external S3).

Prepare a dedicated private host folder writable by the container's app user.
For rootful Docker without user-namespace remapping:

```sh
sudo install -d -m 700 -o 1654 -g 1654 /private/evidence-export
docker compose -f compose.yaml run --rm --no-deps \
  --volume /private/evidence-export:/var/lib/vessel/export \
  api evidence-copy-to-local --destination /var/lib/vessel/export
docker compose -f compose.yaml run --rm --no-deps \
  --volume /private/evidence-export:/var/lib/vessel/export \
  api evidence-copy-to-local --destination /var/lib/vessel/export --apply
```

Use the mapped host UID with rootless Docker/user namespaces instead. The S3
settings still identify the **old/source** bucket. Rerun without `--apply` and
confirm every image already verifies. Local conflicts are never overwritten.
`--no-deps` prevents a schema migration or any dependent service startup.
The host bind mount, not the container's ephemeral filesystem, retains the copy.

For another S3 provider, make a separate mode-600 `.env.copy-destination` from
the installation's `.env`, retaining the same database/owner/auth values and
changing only the S3 endpoint, bucket, region, addressing and credentials.
Provision that private bucket first; keep the running installation unchanged.
Upload the export through a **read-only** mount:

```sh
docker compose --env-file .env.copy-destination \
  -f compose.yaml -f compose.storage-external.yaml run --rm --no-deps \
  --volume /private/evidence-export:/var/lib/vessel/export:ro \
  api evidence-copy-to-s3 --source /var/lib/vessel/export
docker compose --env-file .env.copy-destination \
  -f compose.yaml -f compose.storage-external.yaml run --rm --no-deps \
  --volume /private/evidence-export:/var/lib/vessel/export:ro \
  api evidence-copy-to-s3 --source /var/lib/vessel/export --apply
```

Keep writers stopped through export/import/cutover. After a successful
verification rerun, explicitly update the installation's S3 settings, restart
API/web and verify authenticated image reads and a new upload. Keep the old
bucket, local copy and coordinated backups until verified. To switch to Local
instead, persistently mount this export at the configured Local root and select
`Provider=Local` before restarting. Neither command changes configuration,
deletes originals or copies database notes/markup; this is not a complete
application/bucket backup. See the
[portable-copy guarantees](../docs/architecture/evidence-storage.md#s3-to-local-or-another-s3-provider).

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

The API and the worker read each venue's host from `Vessel:Venues`. The
defaults are the production hosts, so most installations set nothing. To point
a venue at a different host, for example an egress proxy, add the matching
variable to both the `api` and the `worker` services' `environment` in your own
Compose override file and include it on every Compose command. The worker makes
all monitor reads, so setting it only on the API leaves monitoring on the
default hosts. The example `compose.yaml` does not forward these
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
with an invalid value, and so does the worker; both name only the key, never the value. A host receives
the venue's read-only tokens, so configure only hosts you trust as much as the
venue itself.

## Start and connect

Without optional credential storage:

```sh
docker compose up -d
docker compose ps -a
```

Compose waits for healthy PostgreSQL and RabbitMQ, then runs `/app/migrate` as a
deliberate one-shot step. The wrapper runs the EF bundle, then messaging provisioning
(envelope storage, broker topology and insert-only subscription registrations).
It then starts API and worker and waits for API readiness before starting web.
The EF bundle reads `ConnectionStrings__Vessel` from its environment through the
design-time factory. The password is not an argument and the bundle does not
print it. Neither API nor worker migrates or auto-provisions message storage at
startup. Missing storage is a setup error, not permission to migrate a live database.

The worker uses `/app/worker` in the same versioned API image and has no HTTP
ingress or host port. It runs the modules in `Vessel__Worker__Modules` (Compose:
`monitor`) in the logical deployment `Vessel__Worker__Deployment` (default: the
first module), which names its envelope schema (`wolverine_monitor`) and service.
An unknown module stops startup. Replicas of one deployment share its schema.
Every worker also runs subscription catch-up for the subscriptions it hosts and
the hourly event retention sweep; both are claimed in PostgreSQL and safe with
replicas. It scopes every database operation to the configured owner
(`Vessel__Auth__OwnerId`, the same setting the API authenticates with) and
dead-letters a command naming another owner, logging only IDs.

`RunAccountMonitor` commands are only a hand-off: the pending request lives in
PostgreSQL (`monitor_accounts`), the listener acknowledges once it has validated
it and wakes the scheduler, and a lost command is found on the next 30-second
tick. After each productive scheduling pass (discovery and claims), the worker
writes a database heartbeat and a local heartbeat file holding the time and the
configured timeout; `/app/worker-health` rejects a missing, malformed or older
file. If the file cannot be written, the database heartbeat is not recorded
either, so API monitor responses report the worker offline.

A later Notification Hub worker is the same image with other modules, as a
separate service that scales independently, for example:

```yaml
  worker-notifications:
    image: skorcius/vessel:api-${VESSEL_VERSION}
    entrypoint: ["/app/worker"]
    environment:
      # ... the worker service's database, owner and broker settings ...
      Vessel__Worker__Modules__0: notifications
```

That module does not exist yet; Compose has no such service, and an unknown
module name stops the worker.

### Monitor and broker settings

`VESSEL_MONITOR_INTERVAL`, `VESSEL_MONITOR_PROTECTION_GRACE` and
`VESSEL_MONITOR_MANUAL_COOLDOWN` are TimeSpan strings, such as `00:10:00`.
They map to `Vessel:Monitor:Interval`, `ProtectionGrace` and `ManualCooldown`.
The defaults are ten minutes, ten minutes and sixty seconds. Interval is
validated from one through sixty minutes and scheduling adds ten-percent
jitter. The cooldown may not exceed the interval and gates manual Check and
Refresh only, never scheduled or confirmation runs; failed checks also start
it. Check and account Refresh share admission and the two-account read limit.
A Refresh never changes check backoff, monitor state or the scheduled check, and
a refused or abandoned Refresh is never replayed by the worker.
`Vessel:Monitor:WatchLifetime` (default `7.00:00:00`) bounds how long the linked
exits and entries of a closed or cancelled Play are watched; after it, a watch
without proof ends as a persistent `unverifiable`, never as resolved.
`Vessel:Monitor:UnobservableLifetime` (default `7.00:00:00`) bounds how long a
discrepancy's subject may stay unobservable before the record becomes
`unverifiable` and stops holding the account in monitoring. Both accept one hour
to ninety days.
Venue HTTP 429 `Retry-After` deadlines are retained in PostgreSQL per owner and
venue. Check, Refresh and scheduled work respect the longest deadline across
API and worker instances; a shorter later response cannot shorten it. A missing
or invalid `Retry-After` uses a sixty-second delay, and any deadline is clamped to
at most one hour. The API exposes the effective
manual deadline and returns it as `Retry-After` when admission is throttled.

`Vessel:Monitor:HeartbeatTimeout` defaults to `00:01:30`, with a minimum
`00:00:30`. `Vessel:Monitor:HeartbeatFile` defaults to
`/tmp/vessel-worker-heartbeat`. The packaged health script reads the timeout the
worker wrote into that file. `Vessel:Events:RetentionDays` defaults to 90.
Pruning leaves pending delivery work and deduplication history intact.

RabbitMQ is pinned to `rabbitmq:4.3.6-management`, with a named `rabbitmq`
volume and a stable hostname. Durable quorum queues, the `vessel.events`
topic exchange and consumer bindings are declared by the explicit provisioning
step. Publisher confirmations do not replace consumer receipts.
`VESSEL_RABBITMQ_MANAGEMENT_BIND` defaults to `127.0.0.1:15672`. Use an SSH tunnel
or an HTTPS proxy to reach it remotely, never plain HTTP to the internet.
Before upgrading RabbitMQ, enable the current version's feature flags and follow
its supported upgrade path.

PostgreSQL is the record; RabbitMQ is transport. Subscribers recover unsettled
retained events from PostgreSQL through catch-up, and pending manual requests are
recovered from `monitor_accounts` with their original request ID. A lost broker
volume costs latency, not data; dead-letter contents and broker diagnostics are not
reconstructed. Do not add the broker volume to the database/evidence backup
archive.

### Broker users and passwords

`RABBITMQ_USER`/`RABBITMQ_PASSWORD` create the broker's administrator on the
**first** start of an empty `rabbitmq` volume only; changing them in `.env` later
does not change the broker. That user is what `migrate` needs to declare topology.
Use URL-safe passwords (for example `openssl rand -hex 24`): Compose places them in
an AMQP URI. To rotate the password, change it in the broker, then in `.env`, and
recreate the services that connect:

```sh
docker compose exec rabbitmq rabbitmqctl change_password "$RABBITMQ_USER" 'NEW-URL-SAFE-PASSWORD'
# update RABBITMQ_PASSWORD (and RABBITMQ_APP_PASSWORD if used) in .env, then:
docker compose up -d --force-recreate api worker
```

For least privilege, API and worker can use a separate, non-administrator
application user limited to the `vessel.` names (hosts declare nothing at
runtime: no reply queue, no topology), while `migrate` keeps the administrator.
The broker tests pass with exactly these permissions. Create it once and set `RABBITMQ_APP_USER`/`RABBITMQ_APP_PASSWORD`
in `.env`; without them API and worker use the administrator:

```sh
docker compose exec rabbitmq rabbitmqctl add_user vessel-app 'URL-SAFE-PASSWORD'
# configure, write (commands are published through the default exchange), read
docker compose exec rabbitmq rabbitmqctl set_permissions -p / vessel-app \
  '^vessel\..*' '^(vessel\..*|amq\.default)$' '^vessel\..*'
docker compose up -d --force-recreate api worker
```

The management page is published for troubleshooting and bound to loopback by
default; it shows queue contents to anyone with broker credentials. Leave
`VESSEL_RABBITMQ_MANAGEMENT_BIND` on loopback unless an HTTPS proxy fronts it.

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

### From v0.1.2 to v0.1.3

This upgrade includes migration `20261016104756_PlayDirection`, which adds a
`Direction` column to saved Plays, fills it from each Play's plan and adds two
list indexes. Back up the database first and keep web and API stopped while the
explicit migration service runs, as in the [upgrade procedure](#upgrade-procedure).
After the migration, older API images can no longer save new Plays, because
they do not write the new column; roll back by restoring the backup, not by
starting an older image. Storage, credentials and Compose files are unchanged.

### From v0.1.1 to v0.1.2

There is no migration. With no storage settings the API keeps its original
local evidence folder, but the example `compose.yaml` now selects private
RustFS. If you take the new file and keep images locally, add
`-f compose.storage-local.yaml` to every Compose command; without it the stack
uses RustFS, where your existing images are not present. To move them to S3,
follow [Copy existing local images to S3](#copy-existing-local-images-to-s3)
first. Do not use the S3 default with an API image older than v0.1.2. The
PostgreSQL health check now probes TCP, so first-time starts no longer let the
migration service connect before the database is ready.

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

### To the account monitor release

This upgrade adds two services and new required settings. Before it:

- Add `RABBITMQ_USER` and `RABBITMQ_PASSWORD` (URL-safe) to `.env`, and keep
  `Vessel__Auth__OwnerId` set: the worker and the provisioning step validate
  every message against it. Optional: `VESSEL_RABBITMQ_MANAGEMENT_BIND`,
  `VESSEL_MONITOR_*`, `RABBITMQ_APP_USER`/`RABBITMQ_APP_PASSWORD`.
- Messaging settings are `Vessel__Messaging__*` (for example
  `Vessel__Messaging__RabbitMqUri`, which Compose builds for you).
- Migrations `20261014180000_VesselEvents`, `20261015072425_AccountMonitor`,
  `20261015072500_MessagingDeployments`, `20261015073737_PlayDiscrepancies` and
  `20261015172843_PlayDiscrepancyUnverifiable` add the event log, subscriptions
  and receipts, monitor state, the deployment registrations and discrepancies.
- `migrate` now also runs `provision-messaging` against the new `rabbitmq`
  service, which must be healthy first; then `api` and the new `worker` start.
- The restore procedure gains the mandatory `rotate-event-epoch` step below.

Stop web, API and worker, back up, then follow the procedure below. A worker
stopped during a run loses nothing: runs are idempotent and the next run repeats
the work.

### Upgrade procedure

Back up first, read the changelog, and set `VESSEL_VERSION` to the chosen release:

```sh
docker compose pull
docker compose stop web api worker
docker compose up -d
docker compose ps -a
```

`up` restarts the completed migration service and applies any pending migrations
before API and worker start. Re-running it against the same version is idempotent.
Stop web, API and worker first when a schema change is expected, so no old process
uses the schema while it changes. This
ordering is the explicit deployment migration step, not API startup migration.
Do not use `docker compose restart` to upgrade or apply migrations. Failed
migrations block API startup; inspect the migration logs before proceeding.
Use both `-f` options above when credential storage is configured.
An application downgrade does not roll back the database. Restore backups if a
new schema is incompatible with the old image.

## Backups

Keep backups private and test restores in an isolated installation. Stop web, API
and worker to keep database references and evidence consistent, then (the RabbitMQ
volume is excluded: subscribers recover unsettled events from PostgreSQL):

```sh
umask 077
mkdir -p backups
docker compose stop web api worker
docker compose exec -T postgres pg_dump -U vessel -d vessel -Fc > backups/vessel.dump
docker compose stop rustfs
docker compose run --rm --no-deps -T --entrypoint tar rustfs \
  -C /data -czf - . > backups/objects.tar.gz
docker compose up -d
```

Back up the credential ring **separately**, with restricted permissions and a
separate protected destination. Save the owner GUID and operator settings
privately too. Do not put the keys inside the database or evidence archive.
PostgreSQL 18 stores its data below the named volume mounted at
`/var/lib/postgresql`. Do not copy a live data directory as a substitute for
`pg_dump`. RustFS uses the named `objects` volume at `/data`, owned by UID 10001.
Archive the **entire** stopped volume, including RustFS metadata, and initially
restore with the same RustFS version. This is not a directory of original images;
use the S3 API for cross-provider copies. Restore it, the database and the same key ring into a
disposable deployment before relying on the procedure. The local release
verification exercises the restore below with synthetic records and evidence.

With `compose.storage-local.yaml`, keep web, API and worker stopped but replace the RustFS
stop/archive commands with:

```sh
docker compose -f compose.yaml -f compose.storage-local.yaml run --rm --no-deps -T \
  --entrypoint tar api -C /var/lib/vessel/evidence -czf - . > backups/evidence.tar.gz
```

## Isolated restore

Use a new private operator directory, a unique project name and **fresh** named
volumes, not an existing installation. Copy the deploy files and create a private
`.env` with a new database password, the **same** `Vessel__Auth__OwnerId`, and the
saved operator settings. You may rotate the Vessel login token. Select the image
version that produced the backup first. Bind web to an unused loopback port and
choose an unused subnet and pinned service IPs. Do not start web, API or worker yet. The
broker volume is not restored; RabbitMQ starts empty and subscribers recover
unsettled retained events from PostgreSQL.

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

# Extract only your trusted RustFS archive before RustFS/API start.
docker compose -p vessel-restore-check run --rm --no-deps -T \
  --user 0 --entrypoint sh rustfs -c \
  'tar -xzf - -C /data && chown -R 10001:10001 /data' \
  < /private/backups/objects.tar.gz
```

For a local-folder backup, include `compose.storage-local.yaml`, restore
`evidence.tar.gz` using service `api`, path `/var/lib/vessel/evidence` and UID/GID
`1654:1654` instead. Never extract a RustFS archive into the API's evidence root.

Place the original credential ring in a separate mode-700 secret directory,
not the operator directory, database or evidence archive. Preserve every original
key ID and byte, including retired keys needed by retained credentials. On rootful
Docker set the file owner to `1654:1654` and mode to `0600`; apply the mapped UID
for rootless/user-namespace deployments. Use a regular, non-symlink file. Set
`VESSEL_CREDENTIAL_KEYS_FILE` to that absolute path and include
`compose.credentials.yaml` on subsequent commands. Generating a new ring cannot
decrypt the restored credentials.

```sh
# Mandatory after every restore and before any host starts: browser cursors from
# before the restore must reset, even once the restored stream reaches their sequence.
docker compose -p vessel-restore-check run --rm --no-deps --entrypoint dotnet migrate \
  /app/Vessel.Api.dll rotate-event-epoch
# This is the explicit migration and provisioning step after restoring, not API startup.
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
# Retained local-folder deployment and restore:
python3 scripts/verify-release.py --storage local
# Isolated RustFS/PostgreSQL protocol and CLI check (no app image build):
python3 scripts/verify-evidence-storage.py
# Optional production browser CSP check, using an already available Playwright:
python3 scripts/verify-release.py --browser-module /absolute/path/to/playwright
# When Playwright's default browser is unavailable, set CHROMIUM_PATH to a
# compatible installed Chromium executable before invoking the same check.
```

It checks HTTP and internal-CA TLS trust, spoofed scheme/address handling,
compression, headers, unbuffered SSE via a local fixture, upload limits, unpublished
web in TLS mode and a fresh-volume restore. For delivery it sets
`Vessel__Messaging__Verification=true` on `migrate` and runs the `verification`
subscription in a separate `verifier` worker (deployment `verification`), leaving
the monitor worker's configuration as shipped: receipts prove live delivery, an
outbox that holds the publication while RabbitMQ is stopped, delivery after the
broker returns and after a restore without the broker volume; the subscription is
deregistered at the end. The fixture replaces only the upstream
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
  migrations. A 503 reveals no database details. It does not verify venue or object-store access.
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
- For S3 failures, check `storage-init` exit status, RustFS health, bucket name
  and server-only credentials without printing them. Confirm an authenticated
  upload/read, not just API readiness. Missing bucket/access/outage errors do not
  fall back to local files.

## Build locally from source

From the repository root, with no populated secret files in the build context:

```sh
REVISION=$(git rev-parse HEAD)
docker build --platform linux/amd64 -f backend/Dockerfile \
  --build-arg VERSION=0.1.3 --build-arg REVISION="$REVISION" \
  -t skorcius/vessel:api-0.1.3 .
docker build --platform linux/amd64 -f frontend/Dockerfile \
  --build-arg VERSION=0.1.3 --build-arg REVISION="$REVISION" \
  -t skorcius/vessel:web-0.1.3 .
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
