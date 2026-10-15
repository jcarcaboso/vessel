import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import dev


class DevelopmentEnvironmentTests(unittest.TestCase):
    def test_credential_configuration_is_loaded_only_for_the_api(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".env").write_text(
                "ConnectionStrings__Vessel=test-connection\n"
                "Vessel__Credentials__ActiveKeyId=test-key\n"
                "Vessel__Credentials__Keys__test-key=test-secret\n"
                "Vessel__Credentials__KeyFile=/private/key-ring.json\n"
                "Vessel__Evidence__Storage__S3__SecretAccessKey=test-s3-secret\n"
                "Vessel__Evidence__Storage__Provider=S3\n"
            )
            with patch.object(dev, "ROOT", root), patch.dict(os.environ, {}, clear=True):
                api = dev.configuration()
                self.assertEqual("test-secret", api["Vessel__Credentials__Keys__test-key"])
                self.assertEqual("/private/key-ring.json", api["Vessel__Credentials__KeyFile"])
                self.assertEqual("test-s3-secret", api["Vessel__Evidence__Storage__S3__SecretAccessKey"])
                self.assertEqual("S3", api["Vessel__Evidence__Storage__Provider"])
                self.assertEqual({}, dev.frontend_environment())

    def test_explicit_environment_wins_without_leaking_to_vite(self):
        values = {
            "PATH": "/bin",
            "Vessel__Auth__Token": "test-auth",
            "Vessel__Credentials__Keys__current": "test-master-key",
            "Vessel__Credentials__ActiveKeyId": "current",
            "Vessel__Credentials__KeyFile": "/private/keys.json",
            "VESSEL__CREDENTIALS__KEYS__uppercase": "test-uppercase",
            "vessel__credentials__keys__lowercase": "test-lowercase",
            "Vessel:Credentials:Keys:colon": "test-colon",
            "CONNECTIONSTRINGS__Vessel": "test-uppercase-connection",
            "ConnectionStrings__Vessel": "test-connection",
            "POSTGRES_PASSWORD": "test-password",
            "Vessel_TEST_POSTGRES": "test-database",
            "INFISICAL_TOKEN": "test-infisical-access-token",
            "infisical_client_secret": "test-infisical-client-secret",
            "Vessel__Evidence__Storage__S3__SecretAccessKey": "test-s3-secret",
            "VESSEL_S3_SECRET_ACCESS_KEY": "test-compose-secret",
            "RUSTFS_SECRET_KEY": "test-rustfs-secret",
            "AWS_SECRET_ACCESS_KEY": "test-aws-secret",
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".env").write_text("Vessel__Credentials__ActiveKeyId=old\n")
            with patch.object(dev, "ROOT", root), patch.dict(os.environ, values, clear=True):
                self.assertEqual("current", dev.configuration()["Vessel__Credentials__ActiveKeyId"])
                self.assertEqual({"PATH": "/bin"}, dev.frontend_environment())

    def test_verification_drops_colon_separated_owner_settings_and_compose_overrides(self):
        safe = {"PATH": "/bin", "DOTNET": "/private-sdk/dotnet", "DOCKER_HOST": "unix:///run/docker.sock",
                "DOTNET_ROOT": "/private-sdk", "DOTNET_CLI_TELEMETRY_OPTOUT": "1",
                "ASPNETCORE_HTTP_PORTS": "8080"}
        unsafe = {
            "Vessel:Credentials:KeyFile": "/tmp/vessel-synthetic-nonexistent-key-ring.json",
            "vessel__credentials__keyfile": "/tmp/another-synthetic-key-ring.json",
            "ConnectionStrings:Vessel": "synthetic-database",
            "CONNECTIONSTRINGS__Vessel": "another-synthetic-database",
            "Vessel:Evidence:Storage:S3:Endpoint": "https://must-not-be-contacted.invalid",
            "VESSEL_S3_ENDPOINT": "https://must-not-be-contacted.invalid",
            "COMPOSE_PROFILES": "unused-storage",
            "compose_file": "/tmp/must-not-be-loaded.yaml",
            "POSTGRES_PASSWORD": "synthetic-password",
            "AWS_SECRET_ACCESS_KEY": "synthetic-secret",
            "DOTNET_Vessel__Credentials__KeyFile": "/tmp/host-prefixed-synthetic-ring.json",
            "aspnetcore_vessel:credentials:keyfile": "/tmp/webhost-prefixed-synthetic-ring.json",
            "DOTNET_ConnectionStrings__Vessel": "host-prefixed-synthetic-database",
            "DOTNET_CONTENTROOT": "/tmp/must-not-be-loaded",
            "ASPNETCORE_ENVIRONMENT": "CallerEnvironment",
            "DOTNET_ApplicationName": "CallerApplication",
            "ASPNETCORE_HOSTINGSTARTUPASSEMBLIES": "CallerStartup",
        }
        with patch.dict(os.environ, {**safe, **unsafe}, clear=True):
            self.assertEqual(safe, dev.verification_environment())

    def test_connection_string_aliases_never_reach_frontend_or_verification(self):
        aliases = ("MYSQL", "SQLAZURE", "SQL", "CUSTOM", "POSTGRESQL", "APIHUB",
                   "DOCDB", "EVENTHUB", "NOTIFICATIONHUB", "REDISCACHE", "SERVICEBUS")
        for alias in aliases:
            for key in (f"{alias}CONNSTR_Vessel", f"{alias.lower()}connstr_Vessel",
                        f"DOTNET_{alias}CONNSTR_Vessel", f"ASPNETCORE_{alias}CONNSTR_Vessel"):
                with self.subTest(key=key), patch.dict(os.environ, {"PATH": "/bin", key: "synthetic-secret"}, clear=True):
                    self.assertEqual({"PATH": "/bin"}, dev.frontend_environment())
                    self.assertEqual({"PATH": "/bin"}, dev.verification_environment())


if __name__ == "__main__":
    unittest.main()
