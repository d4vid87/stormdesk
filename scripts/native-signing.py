#!/usr/bin/env python3
"""Sign native CI packages when credentials exist; required mode fails closed."""
import argparse
import base64
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


def run(*args, **kwargs):
    try:
        subprocess.run([str(arg) for arg in args], check=True, **kwargs)
    except subprocess.CalledProcessError as error:
        # Signing command arguments can contain passwords; never print them on failure.
        raise RuntimeError(f"{Path(str(args[0])).name} failed (exit {error.returncode})") from None


def credentials(names, required):
    values = [os.environ.get(name, "") for name in names]
    if all(values):
        return values
    if any(values) or required:
        raise RuntimeError("Configure all signing secrets: " + ", ".join(names))
    return None


def windows(app, required):
    secrets = credentials(["WINDOWS_CERTIFICATE_PFX", "WINDOWS_CERTIFICATE_PASSWORD"], required)
    if not secrets:
        return False
    tool = shutil.which("signtool")
    if not tool:
        tools = sorted(Path(os.environ.get("ProgramFiles(x86)", "C:/Program Files (x86)"))
                       .glob("Windows Kits/10/bin/*/x64/signtool.exe"))
        if not tools:
            raise RuntimeError("Windows SDK SignTool was not found")
        tool = str(tools[-1])
    with tempfile.TemporaryDirectory(prefix="stormdesk-sign-") as directory:
        certificate = Path(directory) / "certificate.pfx"
        certificate.write_bytes(base64.b64decode(secrets[0], validate=True))
        run(tool, "sign", "/f", certificate, "/p", secrets[1], "/fd", "SHA256",
            "/tr", "http://timestamp.digicert.com", "/td", "SHA256", app)
        run(tool, "verify", "/pa", "/v", app)
    return True


def macos(app, dmg, required):
    names = ["APPLE_CERTIFICATE_P12", "APPLE_CERTIFICATE_PASSWORD", "APPLE_SIGNING_IDENTITY",
             "APPLE_ID", "APPLE_TEAM_ID", "APPLE_APP_SPECIFIC_PASSWORD"]
    secrets = credentials(names, required)
    dmg.parent.mkdir(parents=True, exist_ok=True)
    if not secrets:
        run("macdeployqt", app, "-always-overwrite")
        run("hdiutil", "create", "-volname", "StormDesk", "-srcfolder", app.parent,
            "-ov", "-format", "UDZO", dmg)
        return False
    encoded, password, identity, apple_id, team, apple_password = secrets
    if not identity.startswith("Developer ID Application:"):
        raise RuntimeError("A Developer ID Application signing identity is required")
    with tempfile.TemporaryDirectory(prefix="stormdesk-sign-") as directory:
        certificate = Path(directory) / "certificate.p12"
        certificate.write_bytes(base64.b64decode(encoded, validate=True))
        keychain = Path(directory) / "signing.keychain-db"
        key_password = os.urandom(24).hex()
        run("security", "create-keychain", "-p", key_password, keychain)
        try:
            run("security", "set-keychain-settings", "-lut", "3600", keychain)
            run("security", "unlock-keychain", "-p", key_password, keychain)
            run("security", "import", certificate, "-k", keychain, "-P", password,
                "-T", "/usr/bin/codesign")
            run("security", "set-key-partition-list", "-S", "apple-tool:,apple:",
                "-s", "-k", key_password, keychain)
            existing = subprocess.check_output(["security", "list-keychains", "-d", "user"],
                                               text=True)
            import shlex
            old_keychains = shlex.split(existing)
            run("security", "list-keychains", "-d", "user", "-s", keychain, *old_keychains)
            try:
                run("macdeployqt", app, "-always-overwrite", "-sign-for-notarization=" + identity)
                run("codesign", "--verify", "--deep", "--strict", app)
                run("hdiutil", "create", "-volname", "StormDesk", "-srcfolder", app.parent,
                    "-ov", "-format", "UDZO", dmg)
                run("codesign", "--force", "--timestamp", "--sign", identity, dmg)
                result = Path(directory) / "notary-result.json"
                with result.open("w") as output:
                    run("xcrun", "notarytool", "submit", dmg, "--apple-id", apple_id,
                        "--team-id", team, "--password", apple_password, "--wait",
                        "--timeout", "30m", "--output-format", "json", stdout=output)
                reply = json.loads(result.read_text())
                if reply.get("status") != "Accepted":
                    raise RuntimeError("Apple notarization was not accepted; submission " +
                                       str(reply.get("id", "unknown")))
                run("xcrun", "stapler", "staple", dmg)
                run("xcrun", "stapler", "validate", dmg)
                run("spctl", "--assess", "--type", "open", "--context", "context:primary-signature", dmg)
            finally:
                run("security", "list-keychains", "-d", "user", "-s", *old_keychains)
        finally:
            run("security", "delete-keychain", keychain)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("platform", choices=["windows", "macos"])
    parser.add_argument("app", type=Path)
    parser.add_argument("--dmg", type=Path)
    args = parser.parse_args()
    required = os.environ.get("REQUIRE_NATIVE_SIGNING", "false").lower() == "true"
    if not args.app.exists():
        parser.error("Built application does not exist")
    if args.platform == "macos" and not args.dmg:
        parser.error("--dmg is required on macOS")
    signed = windows(args.app, required) if args.platform == "windows" else macos(args.app, args.dmg, required)
    Path("native-signing-status.json").write_text(json.dumps({"platform": args.platform,
        "signed": signed, "notarized": signed and args.platform == "macos"}) + "\n")
    print("Verified signed package" if signed else "Unsigned preview package; signing credentials are not configured")


if __name__ == "__main__":
    main()
