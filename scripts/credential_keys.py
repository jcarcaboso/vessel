#!/usr/bin/env python3
"""Explicit Unix operator setup. Never invoked by the API or development runner."""
import argparse
import base64
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import re
import secrets
import selectors
import signal
import stat
import subprocess
import sys
import time
from urllib.parse import urlsplit

MAX_BYTES = 65536
KEY_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")
ROOT = Path(__file__).resolve().parent.parent


class SetupError(Exception):
    """Only fixed, non-secret diagnostics belong here."""


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise SetupError("Duplicate JSON fields are not allowed.")
        value[key] = item
    return value


def parse_ring(data):
    if not 0 < len(data) <= MAX_BYTES:
        raise SetupError("The key ring is empty or too large.")
    try:
        ring = json.loads(data.decode("utf-8"), object_pairs_hook=unique_object)
        if not isinstance(ring, dict) or set(ring) != {"ActiveKeyId", "Keys"}:
            raise ValueError()
        keys = ring["Keys"]
        if not isinstance(keys, dict) or not 1 <= len(keys) <= 32:
            raise ValueError()
        if not isinstance(ring["ActiveKeyId"], str) or ring["ActiveKeyId"] not in keys:
            raise ValueError()
        for key_id, value in keys.items():
            if not KEY_ID.fullmatch(key_id) or not isinstance(value, str):
                raise ValueError()
            raw = base64.b64decode(value, validate=True)
            if len(raw) != 32:
                raise ValueError()
            # Compare and persist a canonical encoding, not alternate base64 spellings.
            keys[key_id] = base64.b64encode(raw).decode("ascii")
        return ring
    except (ValueError, TypeError, RecursionError):
        raise SetupError("Invalid key ring. Supply an active key ID and 32-byte base64 keys.") from None


@contextmanager
def private_directory(file):
    path = Path(file)
    if not path.is_absolute() or ".." in path.parts or path.parent.resolve() != path.parent:
        raise SetupError("Use an absolute path without symlink directories or parent traversal.")
    if path.is_relative_to(ROOT) or any((parent / ".git").exists() for parent in path.parents):
        raise SetupError("Credential files must be outside repositories.")
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o700:
            raise SetupError("The parent directory must be owned by this user with mode 700.")
        yield fd, path.name
    finally:
        os.close(fd)


def read_private(directory, name):
    # NONBLOCK prevents an unexpected FIFO from hanging before its type is checked.
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid()
                or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1):
            raise SetupError("Secret files must be regular files without hard links, owned by this user with mode 600.")
        data = stream.read(MAX_BYTES + 1)
        if not 0 < len(data) <= MAX_BYTES:
            raise SetupError("The secret file is empty or too large.")
        return data


def current_ring(directory, name):
    try:
        return parse_ring(read_private(directory, name))
    except FileNotFoundError:
        return None


def write_ring(directory, name, ring, *, replace=False):
    temporary = ".vessel-keys-" + secrets.token_hex(12)
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                 0o600, dir_fd=directory)
    try:
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write((json.dumps(ring, indent=2) + "\n").encode("utf-8"))
            stream.flush()
            os.fsync(stream.fileno())
        if replace:
            os.replace(temporary, name, src_dir_fd=directory, dst_dir_fd=directory)
        else:
            # An atomic, no-overwrite publication. A concurrent creator wins safely.
            os.link(temporary, name, src_dir_fd=directory, dst_dir_fd=directory,
                    follow_symlinks=False)
        os.fsync(directory)
    finally:
        try:
            os.unlink(temporary, dir_fd=directory)
        except FileNotFoundError:
            pass
        os.fsync(directory)


def cli_output(command, env):
    deadline = time.monotonic() + 30
    with subprocess.Popen(command, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                          stderr=subprocess.DEVNULL, start_new_session=True) as process:
        try:
            output = bytearray()
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                while True:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0 or not selector.select(remaining):
                        raise SetupError("Infisical retrieval timed out; no key file was changed.")
                    chunk = os.read(process.stdout.fileno(), min(8192, MAX_BYTES + 1 - len(output)))
                    if not chunk:
                        break
                    output.extend(chunk)
                    if len(output) > MAX_BYTES:
                        raise SetupError("Infisical returned too much data; no key file was changed.")
            if process.wait(timeout=max(0.01, deadline - time.monotonic())) != 0:
                raise SetupError("Infisical retrieval failed. Check CLI authentication, access and connectivity.")
            return bytes(output)
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()


def fetch_infisical(args):
    url = urlsplit(args.domain)
    if (url.scheme != "https" or not url.hostname or url.username is not None
            or url.password is not None or url.query or url.fragment
            or url.path not in ("", "/", "/api", "/api/")
            or any(character.isspace() for character in args.domain)):
        raise SetupError("Infisical requires an HTTPS origin, optionally ending in /api.")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", args.secret_name):
        raise SetupError("Use an alphanumeric Infisical secret name with underscores or hyphens.")
    if not args.secret_path.startswith("/") or ".." in args.secret_path.split("/"):
        raise SetupError("Use an absolute Infisical folder path without parent traversal.")
    if not args.project_id.strip() or not args.environment.strip():
        raise SetupError("Infisical project and environment are required.")
    env = dict(os.environ)
    if args.access_token_file:
        with private_directory(args.access_token_file) as (directory, name):
            token = read_private(directory, name).decode("ascii").strip()
        if not token or any(not 33 <= ord(character) <= 126 for character in token):
            raise SetupError("The Infisical access-token file is invalid.")
        env["INFISICAL_TOKEN"] = token
    # No shell, token arguments, personal overrides, reference expansion, imports or recursion.
    # The official CLI owns authentication and TLS. Restrict its identity to this folder.
    output = cli_output(
        ["infisical", "secrets", "get", args.secret_name,
         "--domain=" + args.domain, "--projectId=" + args.project_id,
         "--env=" + args.environment, "--path=" + args.secret_path,
         "--plain", "--silent", "--expand=false", "--include-imports=false",
         "--recursive=false", "--secret-overriding=false"],
        env,
    )
    return parse_ring(output)


def configure(args):
    with private_directory(args.key_file) as (directory, name):
        # Serialize this tool's writers without creating another persistent secret or lock file.
        fcntl.flock(directory, fcntl.LOCK_EX | fcntl.LOCK_NB)
        old = current_ring(directory, name)
        if args.command == "init":
            if old is not None:
                return "Existing key file is valid; nothing changed."
            if not args.new_installation:
                raise SetupError("No key file exists. Restore it, or confirm first-time setup with --new-installation.")
            ring = {"ActiveKeyId": "current",
                    "Keys": {"current": base64.b64encode(secrets.token_bytes(32)).decode("ascii")}}
        else:
            ring = fetch_infisical(args)
            # Recheck after network I/O, before deciding whether to replace anything.
            old = current_ring(directory, name)
            if old == ring:
                return "Infisical matches the existing key ring; nothing changed."
            if old is not None:
                if any(ring["Keys"].get(key) != value for key, value in old["Keys"].items()):
                    raise SetupError("Refusing to remove or change existing keys. Restore the complete ring in Infisical.")
                if not args.update:
                    raise SetupError("The ring changed. Back up the current ring, then use --update to retain old keys and apply it.")
        write_ring(directory, name, ring, replace=old is not None)
    return "Key file saved. Configure Vessel__Credentials__KeyFile and restart the API."


class SafeParser(argparse.ArgumentParser):
    def error(self, message):
        # Unknown arguments can contain a mistakenly pasted token. Never repeat them.
        raise SetupError("Invalid options. Use --help. Never pass secrets on the command line.")


def main(argv=None):
    try:
        parser = SafeParser(description=__doc__)
        commands = parser.add_subparsers(dest="command", required=True)
        local = commands.add_parser("init", help="Create a key file only for a confirmed first-time setup.")
        local.add_argument("--key-file", required=True)
        local.add_argument("--new-installation", action="store_true")
        remote = commands.add_parser("fetch-infisical", help="Fetch a complete ring using an authenticated Infisical CLI.")
        remote.add_argument("--key-file", required=True)
        remote.add_argument("--domain", required=True)
        remote.add_argument("--project-id", required=True)
        remote.add_argument("--environment", required=True)
        remote.add_argument("--secret-path", required=True)
        remote.add_argument("--secret-name", default="VESSEL_CREDENTIAL_KEY_RING")
        remote.add_argument("--access-token-file")
        remote.add_argument("--update", action="store_true")
        print(configure(parser.parse_args(argv)))
        return 0
    except SetupError as error:
        print(str(error), file=sys.stderr)
    except Exception:
        # OS, CLI and parsing exceptions can contain secrets. No tracebacks or captured output.
        print("Key setup failed. Check private paths, permissions and CLI availability. No secret details are shown.",
              file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
