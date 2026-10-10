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
            )
            with patch.object(dev, "ROOT", root), patch.dict(os.environ, {}, clear=True):
                api = dev.configuration()
                self.assertEqual("test-secret", api["Vessel__Credentials__Keys__test-key"])
                self.assertEqual("/private/key-ring.json", api["Vessel__Credentials__KeyFile"])
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
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".env").write_text("Vessel__Credentials__ActiveKeyId=old\n")
            with patch.object(dev, "ROOT", root), patch.dict(os.environ, values, clear=True):
                self.assertEqual("current", dev.configuration()["Vessel__Credentials__ActiveKeyId"])
                self.assertEqual({"PATH": "/bin"}, dev.frontend_environment())


if __name__ == "__main__":
    unittest.main()
