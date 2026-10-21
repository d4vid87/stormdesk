#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("native_signing", Path(__file__).with_name("native-signing.py"))
signing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(signing)


class SigningTest(unittest.TestCase):
    def test_missing_or_partial_credentials_fail_required_builds(self):
        with patch.dict(signing.os.environ, {}, clear=True):
            self.assertIsNone(signing.credentials(["CERT", "PASSWORD"], False))
            with self.assertRaises(RuntimeError):
                signing.credentials(["CERT", "PASSWORD"], True)
        with patch.dict(signing.os.environ, {"CERT": "present"}, clear=True):
            with self.assertRaises(RuntimeError):
                signing.credentials(["CERT", "PASSWORD"], False)

    def test_errors_do_not_expose_password_arguments(self):
        with patch.object(signing.subprocess, "run", side_effect=subprocess.CalledProcessError(
                1, ["signtool", "/p", "private-password"])):
            with self.assertRaisesRegex(RuntimeError, "signtool failed") as error:
                signing.run("signtool", "/p", "private-password")
            self.assertNotIn("private-password", str(error.exception))

    def test_windows_signs_then_verifies_and_removes_certificate(self):
        calls = []
        def record(*args):
            calls.append(tuple(str(arg) for arg in args))
        with patch.dict(signing.os.environ, {"WINDOWS_CERTIFICATE_PFX": "Y2VydA==",
                        "WINDOWS_CERTIFICATE_PASSWORD": "secret"}, clear=True), \
                patch.object(signing.shutil, "which", return_value="signtool"), \
                patch.object(signing, "run", side_effect=record):
            self.assertTrue(signing.windows(Path("stormdesk.exe"), True))
        self.assertEqual(calls[0][1], "sign")
        self.assertEqual(calls[1][1:3], ("verify", "/pa"))
        self.assertFalse(Path(calls[0][3]).exists())

    def test_mac_notarization_is_required_and_keychain_is_cleaned(self):
        env = {"APPLE_CERTIFICATE_P12": "Y2VydA==", "APPLE_CERTIFICATE_PASSWORD": "secret",
               "APPLE_SIGNING_IDENTITY": "Developer ID Application: Test (TEAM)",
               "APPLE_ID": "test@example.com", "APPLE_TEAM_ID": "TEAM",
               "APPLE_APP_SPECIFIC_PASSWORD": "secret"}
        for status in ["Accepted", "Invalid"]:
            calls = []
            def record(*args, **kwargs):
                calls.append(tuple(str(arg) for arg in args))
                if args[:3] == ("xcrun", "notarytool", "submit"):
                    kwargs["stdout"].write('{"status":"' + status + '","id":"submission"}')
            with patch.dict(signing.os.environ, env, clear=True), \
                    patch.object(signing.subprocess, "check_output", return_value='"login.keychain-db"'), \
                    patch.object(signing, "run", side_effect=record):
                if status == "Accepted":
                    self.assertTrue(signing.macos(Path("dist/stormdesk.app"), Path("out.dmg"), True))
                    self.assertTrue(any(call[:3] == ("xcrun", "stapler", "validate") for call in calls))
                else:
                    with self.assertRaises(RuntimeError):
                        signing.macos(Path("dist/stormdesk.app"), Path("out.dmg"), True)
                    self.assertFalse(any(call[:3] == ("xcrun", "stapler", "staple") for call in calls))
            self.assertEqual(calls[-1][:2], ("security", "delete-keychain"))
            self.assertFalse(Path(calls[-1][2]).exists())

    def test_unsigned_mac_uses_deployment_tool(self):
        with patch.dict(signing.os.environ, {}, clear=True), patch.object(signing, "run") as run:
            self.assertFalse(signing.macos(Path("dist/stormdesk.app"), Path("out.dmg"), False))
            self.assertEqual(run.call_args_list[0].args[0], "macdeployqt")
            self.assertEqual(run.call_args_list[1].args[0], "hdiutil")


if __name__ == "__main__":
    unittest.main()
