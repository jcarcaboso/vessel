#!/usr/bin/env python3
"""Local-only development runner. Secrets stay in the API process environment."""
from pathlib import Path
import os
import signal
import subprocess
import sys
import time
import ipaddress

ROOT = Path(__file__).resolve().parent.parent


def configuration():
    values = {}
    path = ROOT / ".env"
    if path.exists():
        for line in path.read_text().splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            if "=" not in line:
                raise SystemExit("Invalid .env line. Use KEY=value, without shell commands.")
            key, value = line.split("=", 1)
            literal = value.strip()
            if len(literal) >= 2 and literal[0] in "'\"" and literal[-1] == literal[0]:
                literal = literal[1:-1]
            values[key.strip()] = literal
    # Explicit process environment takes precedence over the local development file.
    values.update(os.environ)
    env = dict(os.environ)
    for key in ["Vessel__Auth__Token", "Vessel__Auth__OwnerId", "Vessel__Auth__OwnerName"]:
        if key in values:
            env[key] = values[key]
    if values.get("ConnectionStrings__Vessel"):
        env["ConnectionStrings__Vessel"] = values["ConnectionStrings__Vessel"]
    else:
        password = values.get("POSTGRES_PASSWORD", "")
        if not password or password.startswith("replace-"):
            raise SystemExit("Set a private POSTGRES_PASSWORD in the ignored root .env first.")
        quoted = password.replace('"', '""')
        env["ConnectionStrings__Vessel"] = (
            'Host=127.0.0.1;Port=55432;Database=vessel;Username=vessel;Password="' + quoted + '"'
        )
    return env


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "run"
    env = configuration()
    if mode == "migrate":
        subprocess.run(["dotnet", "tool", "restore"], cwd=ROOT / "backend", env=env, check=True)
        subprocess.run(
            ["dotnet", "ef", "database", "update", "--project", "src/Vessel.Persistence"],
            cwd=ROOT / "backend", env=env, check=True,
        )
        return
    if mode not in ["run", "api", "lan"]:
        raise SystemExit("Use run, api, lan, or migrate.")
    host = "127.0.0.1"
    if mode == "lan":
        host = os.environ.get("Vessel_DEV_HOST", "")
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            raise SystemExit("Set Vessel_DEV_HOST to the server's private LAN IPv4 address.") from None
        if address.version != 4 or not address.is_private or address.is_loopback or address.is_unspecified or address.is_multicast:
            raise SystemExit("LAN preview must bind an explicit private, non-loopback IPv4 address.")
    token = env.get("Vessel__Auth__Token", "")
    if not token or token.startswith("replace-"):
        raise SystemExit("Set a private Vessel__Auth__Token in root .env or process environment first.")
    processes = []
    def stop(*_):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stop)
    try:
        api_command = ["dotnet", "run", "--project", "backend/src/Vessel.Api"]
        if mode == "lan":
            api_command += ["--configuration", "Release", "--no-build", "--no-launch-profile",
                            "--urls", "http://127.0.0.1:5080"]
            env["ASPNETCORE_ENVIRONMENT"] = "Development"
        processes.append(subprocess.Popen(
            api_command,
            cwd=ROOT, env=env, start_new_session=True,
        ))
        if mode in ["run", "lan"]:
            # Do not give the frontend process database credentials or the API token.
            web_env = {k: v for k, v in os.environ.items() if
                       not k.startswith(("Vessel__Auth__", "ConnectionStrings__")) and
                       k not in ["POSTGRES_PASSWORD", "Vessel_TEST_POSTGRES"]}
            processes.append(subprocess.Popen(
                ["pnpm", "--filter", "vessel-frontend", "dev", "--host", host],
                cwd=ROOT, env=web_env, start_new_session=True,
            ))
            print(f"Frontend: http://{host}:5180 · API: http://127.0.0.1:5080", flush=True)
            print("Token is read privately from root .env. Stop with Ctrl+C; PostgreSQL remains mounted.", flush=True)
        while True:
            for process in processes:
                if process.poll() is not None:
                    raise SystemExit(process.returncode)
            time.sleep(0.25)
    except KeyboardInterrupt:
        pass
    finally:
        for process in processes:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
        for process in processes:
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()


if __name__ == "__main__":
    main()
