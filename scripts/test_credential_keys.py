import base64
from contextlib import redirect_stderr, redirect_stdout
import fcntl
import io
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

import credential_keys as keys


def ring(active="current"):
    return {"ActiveKeyId": active, "Keys": {
        "current": base64.b64encode(b"a" * 32).decode(),
        **({"next": base64.b64encode(b"b" * 32).decode()} if active == "next" else {}),
    }}


class CredentialKeySetupTests(unittest.TestCase):
    def setUp(self):
        # Keep synthetic key material out of checkouts, including hosts with a /tmp Git repo.
        self.temporary = tempfile.TemporaryDirectory(prefix="vessel-key-test-", dir="/var/tmp")
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.file = self.directory / "keys.json"

    def invoke(self, command="init", *extra):
        stdout, stderr = io.StringIO(), io.StringIO()
        arguments = [command, "--key-file", str(self.file)]
        if command == "fetch-infisical":
            arguments += ["--domain", "https://secrets.example.test", "--project-id", "test-project",
                          "--environment", "prod", "--secret-path", "/vessel-keys"]
        with redirect_stdout(stdout), redirect_stderr(stderr):
            result = keys.main(arguments + list(extra))
        return result, stdout.getvalue(), stderr.getvalue()

    def save(self, value=None):
        self.file.write_text(json.dumps(value or ring()))
        self.file.chmod(0o600)

    def test_initialization_requires_confirmation_and_never_calls_infisical(self):
        self.assertEqual(1, self.invoke()[0])
        self.assertFalse(self.file.exists())
        with patch.object(keys, "cli_output", side_effect=AssertionError("unexpected network")):
            status, out, err = self.invoke("init", "--new-installation")
        self.assertEqual(0, status, err)
        value = keys.parse_ring(self.file.read_bytes())
        self.assertEqual("current", value["ActiveKeyId"])
        self.assertEqual(32, len(base64.b64decode(value["Keys"]["current"])))
        self.assertEqual(0o600, stat.S_IMODE(self.file.stat().st_mode))
        self.assertNotIn(value["Keys"]["current"], out + err)

    def test_valid_existing_file_is_not_replaced_or_regenerated(self):
        self.save()
        before, inode = self.file.read_bytes(), self.file.stat().st_ino
        with patch.object(keys.secrets, "token_bytes", side_effect=AssertionError("regenerated")):
            self.assertEqual(0, self.invoke("init", "--new-installation")[0])
            self.assertEqual(0, self.invoke()[0])
        self.assertEqual(before, self.file.read_bytes())
        self.assertEqual(inode, self.file.stat().st_ino)

    def test_invalid_existing_file_is_preserved_without_echoing_it(self):
        self.file.write_text("SENSITIVE-MALFORMED-KEY")
        self.file.chmod(0o600)
        status, out, err = self.invoke("init", "--new-installation")
        self.assertEqual(1, status)
        self.assertEqual("SENSITIVE-MALFORMED-KEY", self.file.read_text())
        self.assertNotIn("SENSITIVE-MALFORMED-KEY", out + err)

    def test_loose_parent_and_file_permissions_are_rejected_without_repair(self):
        self.directory.chmod(0o755)
        self.assertEqual(1, self.invoke("init", "--new-installation")[0])
        self.assertFalse(self.file.exists())
        self.directory.chmod(0o700)
        self.save()
        self.file.chmod(0o644)
        self.assertEqual(1, self.invoke("init", "--new-installation")[0])
        self.assertEqual(0o644, stat.S_IMODE(self.file.stat().st_mode))

    def test_repositories_and_symlink_directories_are_rejected(self):
        (self.directory / ".git").write_text("gitdir: elsewhere")
        self.assertEqual(1, self.invoke("init", "--new-installation")[0])
        (self.directory / ".git").unlink()
        real = self.directory / "private"
        real.mkdir(mode=0o700)
        link = self.directory / "link"
        link.symlink_to(real, target_is_directory=True)
        self.file = link / "keys.json"
        self.assertEqual(1, self.invoke("init", "--new-installation")[0])
        self.assertFalse((real / "keys.json").exists())

    def test_symlinks_hard_links_and_fifos_are_rejected_before_fetching(self):
        target = self.directory / "other"
        target.write_text(json.dumps(ring()))
        target.chmod(0o600)
        with patch.object(keys, "fetch_infisical") as fetch:
            for kind in ("symlink", "dangling", "hardlink", "fifo"):
                with self.subTest(kind=kind):
                    if kind in ("symlink", "dangling"):
                        self.file.symlink_to(target if kind == "symlink" else self.directory / "missing")
                    elif kind == "hardlink":
                        os.link(target, self.file)
                    else:
                        os.mkfifo(self.file, 0o600)
                    self.assertEqual(1, self.invoke("fetch-infisical", "--update")[0])
                    self.file.unlink()
            fetch.assert_not_called()

    def test_new_keys_differ_between_installations(self):
        self.assertEqual(0, self.invoke("init", "--new-installation")[0])
        first = self.file.read_bytes()
        self.file = self.directory / "second.json"
        self.assertEqual(0, self.invoke("init", "--new-installation")[0])
        self.assertNotEqual(first, self.file.read_bytes())

    def test_failed_write_leaves_no_partial_file(self):
        with patch.object(keys.os, "fsync", side_effect=OSError("SENSITIVE-DISK-ERROR")):
            status, out, err = self.invoke("init", "--new-installation")
        self.assertEqual(1, status)
        self.assertEqual([], list(self.directory.iterdir()))
        self.assertNotIn("SENSITIVE-DISK-ERROR", out + err)

    def test_concurrent_creation_wins_without_being_overwritten(self):
        def create_then_fail(*args, **kwargs):
            self.save()
            raise FileExistsError()
        with patch.object(keys.os, "link", side_effect=create_then_fail):
            self.assertEqual(1, self.invoke("init", "--new-installation")[0])
        self.assertEqual(ring(), keys.parse_ring(self.file.read_bytes()))
        self.assertEqual([self.file], list(self.directory.iterdir()))

    def test_other_tool_writer_is_not_allowed_to_race(self):
        fd = os.open(self.directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertEqual(1, self.invoke("init", "--new-installation")[0])
            self.assertFalse(self.file.exists())
        finally:
            os.close(fd)

    def test_infisical_can_provision_the_same_format_without_local_key_generation(self):
        with patch.object(keys, "cli_output", return_value=json.dumps(ring()).encode()) as cli:
            status, out, err = self.invoke("fetch-infisical")
        self.assertEqual(0, status, err)
        self.assertEqual(ring(), keys.parse_ring(self.file.read_bytes()))
        command, _ = cli.call_args.args
        self.assertEqual(["infisical", "secrets", "get", "VESSEL_CREDENTIAL_KEY_RING"], command[:4])
        for flag in ("--plain", "--silent", "--expand=false", "--include-imports=false",
                     "--recursive=false", "--secret-overriding=false", "--env=prod",
                     "--path=/vessel-keys", "--domain=https://secrets.example.test"):
            self.assertIn(flag, command)
        self.assertNotIn(ring()["Keys"]["current"], out + err)

    def test_complete_fetch_command_with_a_local_cli_stub(self):
        executable = self.directory / "infisical"
        executable.write_text(
            f"#!{sys.executable}\n"
            "import os,sys\n"
            "assert sys.argv[1:4] == ['secrets','get','VESSEL_CREDENTIAL_KEY_RING']\n"
            "assert '--secret-overriding=false' in sys.argv\n"
            "assert os.environ['INFISICAL_TOKEN'] == 'SYNTHETIC-CLI-TOKEN'\n"
            f"print({json.dumps(ring())!r})\n"
        )
        executable.chmod(0o700)
        with patch.dict(os.environ, {"PATH": str(self.directory), "INFISICAL_TOKEN": "SYNTHETIC-CLI-TOKEN"}):
            status, out, err = self.invoke("fetch-infisical")
        self.assertEqual(0, status, err)
        self.assertEqual(ring(), keys.parse_ring(self.file.read_bytes()))
        self.assertNotIn("SYNTHETIC-CLI-TOKEN", out + err)
        self.assertNotIn(ring()["Keys"]["current"], out + err)

    def test_matching_remote_ring_is_a_noop_and_rotation_requires_update(self):
        self.save()
        before = self.file.stat().st_ino
        with patch.object(keys, "fetch_infisical", return_value=ring()):
            self.assertEqual(0, self.invoke("fetch-infisical")[0])
        self.assertEqual(before, self.file.stat().st_ino)
        with patch.object(keys, "fetch_infisical", return_value=ring("next")):
            self.assertEqual(1, self.invoke("fetch-infisical")[0])
            self.assertEqual(ring(), keys.parse_ring(self.file.read_bytes()))
            self.assertEqual(0, self.invoke("fetch-infisical", "--update")[0])
        self.assertEqual(ring("next"), keys.parse_ring(self.file.read_bytes()))
        self.assertEqual(0o600, stat.S_IMODE(self.file.stat().st_mode))

    def test_key_removal_or_reuse_is_rejected_even_with_update(self):
        self.save()
        for replacement in ({"ActiveKeyId": "next", "Keys": {"next": ring("next")["Keys"]["next"]}},
                            {"ActiveKeyId": "current", "Keys": {"current": ring("next")["Keys"]["next"]}}):
            with self.subTest(replacement=replacement):
                with patch.object(keys, "fetch_infisical", return_value=replacement):
                    self.assertEqual(1, self.invoke("fetch-infisical", "--update")[0])
                self.assertEqual(ring(), keys.parse_ring(self.file.read_bytes()))

    def test_remote_errors_do_not_use_local_fallback_or_reveal_diagnostics(self):
        self.save()
        for error in (FileNotFoundError("SENSITIVE-PATH"),
                      RuntimeError("SENSITIVE-TOKEN")):
            with patch.object(keys, "cli_output", side_effect=error):
                status, out, err = self.invoke("fetch-infisical", "--update")
            self.assertEqual(1, status)
            self.assertNotIn("SENSITIVE", out + err)
            self.assertEqual(ring(), keys.parse_ring(self.file.read_bytes()))
        for output in (b"", b"SENSITIVE-BAD-JSON", b"x" * (keys.MAX_BYTES + 1)):
            with patch.object(keys, "cli_output", return_value=output):
                self.assertEqual(1, self.invoke("fetch-infisical", "--update")[0])
            self.assertEqual(ring(), keys.parse_ring(self.file.read_bytes()))

    def test_access_token_stays_in_cli_environment_not_arguments_or_output(self):
        token = self.directory / "infisical-token"
        token.write_text("SYNTHETIC-ACCESS-TOKEN\n")
        token.chmod(0o600)
        with patch.object(keys, "cli_output", return_value=json.dumps(ring()).encode()) as cli:
            status, out, err = self.invoke("fetch-infisical", "--access-token-file", str(token))
        self.assertEqual(0, status, err)
        command, env = cli.call_args.args
        self.assertEqual("SYNTHETIC-ACCESS-TOKEN", env["INFISICAL_TOKEN"])
        self.assertNotIn("SYNTHETIC-ACCESS-TOKEN", " ".join(command) + out + err)
        self.assertNotIn("--token", " ".join(command))
        token.chmod(0o644)
        with patch.object(keys, "cli_output") as cli:
            self.assertEqual(1, self.invoke("fetch-infisical", "--access-token-file", str(token))[0])
            cli.assert_not_called()

    def test_unsafe_domains_and_secret_names_never_reach_cli(self):
        with patch.object(keys, "cli_output") as cli:
            for url in ("http://secrets.example.test", "https://user:pass@example.test",
                        "https://example.test?token=secret", "https://example.test/path",
                        "https://example.test/#secret"):
                self.assertEqual(1, self.invoke("fetch-infisical", "--domain", url)[0])
            for name in ("../secret", "--token=secret", "secret\nvalue"):
                self.assertEqual(1, self.invoke("fetch-infisical", "--secret-name", name)[0])
            cli.assert_not_called()

    def test_unknown_secret_argument_is_not_echoed(self):
        status, out, err = self.invoke("init", "--token", "SENSITIVE-ACCIDENTAL-TOKEN")
        self.assertEqual(1, status)
        self.assertNotIn("SENSITIVE-ACCIDENTAL-TOKEN", out + err)

    def test_strict_key_ring_validation(self):
        values = [
            b'{"ActiveKeyId":"a","ActiveKeyId":"b","Keys":{}}',
            json.dumps({**ring(), "KeyFile": "/another/file"}).encode(),
            json.dumps({"ActiveKeyId": "missing", "Keys": ring()["Keys"]}).encode(),
            json.dumps({"ActiveKeyId": "x", "Keys": {"x": "SENSITIVE-BAD-BASE64"}}).encode(),
            json.dumps({"ActiveKeyId": "x", "Keys": {"x": base64.b64encode(b"short").decode()}}).encode(),
            json.dumps({"ActiveKeyId": "!", "Keys": {"!": ring()["Keys"]["current"]}}).encode(),
            b'{"ActiveKeyId":"x","Keys":null}',
            b'{"ActiveKeyId":null,"Keys":{}}',
            b"[]",
            json.dumps(ring()).encode("utf-16"),
            b"x" * (keys.MAX_BYTES + 1),
        ]
        for value in values:
            with self.subTest(value=value):
                with self.assertRaises(keys.SetupError):
                    keys.parse_ring(value)


class InfisicalCliProcessTests(unittest.TestCase):
    def test_real_subprocess_output_and_failure_are_captured_privately(self):
        output = keys.cli_output([sys.executable, "-c", "print('synthetic-output')"], {})
        self.assertEqual(b"synthetic-output\n", output)
        with self.assertRaises(keys.SetupError) as error:
            keys.cli_output([sys.executable, "-c",
                             "import sys; print('SECRET'); print('SECRET', file=sys.stderr); sys.exit(1)"], {})
        self.assertNotIn("SECRET", str(error.exception))

    def test_oversized_output_is_bounded_and_process_is_stopped(self):
        with self.assertRaisesRegex(keys.SetupError, "too much data"):
            keys.cli_output([sys.executable, "-c",
                             "import sys,time; sys.stdout.write('x'*70000); sys.stdout.flush(); time.sleep(30)"], {})

    def test_timeout_terminates_process_without_including_its_output(self):
        with patch.object(keys.time, "monotonic", side_effect=[0, 31]):
            with self.assertRaisesRegex(keys.SetupError, "timed out"):
                keys.cli_output([sys.executable, "-c", "import time; time.sleep(30)"], {})


if __name__ == "__main__":
    unittest.main()
