# Native release acceptance

The 5.0 packages remain previews. A successful CI build is not physical-device acceptance.

## Current evidence

- Linux: core/UI and collector/API/backup/MQTT integration checks pass. A packaged AppImage has received actual station observations on Wayland.
- Android: the signed ARM64 APK installs beside the legacy app on a Galaxy S24 Ultra running Android 16. Native token onboarding imports the actual Tempest station and receives live observations and forecasts. A partial-repaint defect was found in the separate setup dialog; the replacement onboarding screen must pass the device checks below.
- Windows, macOS and Raspberry Pi: builds are checked in CI; physical-device checks remain outstanding.
- Windows signing and Apple notarization: credentials are not configured in the repository. The CI signing path remains unverified with real certificates.
- Updates: the app checks official GitHub releases and links to a newer native release. It does not replace its own binary or use the legacy Tauri updater.

## Device checks before stable

On each supported device, start with an existing archive backup and retain the previous app.

1. Complete onboarding with a real Tempest token. Verify that the station, coordinates, warnings and NEXRAD WSR-88D selection match the station. Never save tokens or precise coordinates in public reports.
2. Confirm an actual current observation and forecast. Check stale/offline states without presenting old observations as fresh.
3. Exercise every onboarding transition, keyboard entry, scrolling and reopening setup. No retained pixels, clipped fields or inaccessible buttons are acceptable.
4. Move gauges with touch/mouse and verify the order after a new reading and restart. Verify scale changes, portrait/landscape, and system-bar clearance. On Android run `python3 scripts/check-android-insets.py` with that device selected through `ANDROID_SERIAL`.
5. Verify radar navigation, station location and NWS banner event colors. Android currently opens radar in the system browser.
6. Back up and restore the archive, then verify station identity and history. Restore creates a recovery backup; do not overwrite the only copy of an archive.
7. In Settings → App updates, check stable and preview channels, offline feedback and restart persistence. Installation is explicit. Test the next native release without offering legacy 4.x or a downgrade.

## Signing setup

Configure credentials in GitHub repository Actions secrets, never in a source file or chat message.

| Platform | Required secrets |
| --- | --- |
| Windows, exportable Authenticode certificate | `WINDOWS_CERTIFICATE_PFX` (base64 PFX), `WINDOWS_CERTIFICATE_PASSWORD` |
| macOS | `APPLE_CERTIFICATE_P12` (base64 Developer ID Application certificate), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_SPECIFIC_PASSWORD` |

Hardware-backed or remote Windows signing needs its service integration instead of exporting a hardware key. Do not export a non-exportable key or replace it with a self-signed certificate.

Run the `native-cpp` workflow manually with `require_signing` enabled. Missing or partial credentials fail the desktop jobs. Windows signs the application before packaging and verifies Authenticode. Mac deployment signs Qt and WebEngine with hardened runtime, verifies the bundle, submits the DMG to Apple, requires an Accepted result, then staples and validates the ticket. Signing reports are included in the desktop artifacts; unsigned previews report `signed: false` explicitly.

Certificate signing and store distribution require the account owner's existing enrollment. This workflow does not create accounts, purchase certificates or accept developer agreements.

## Stable promotion

Keep the native release marked prerelease until all device checks and required signing checks pass. Publish checksums and build revisions with the exact tested assets. Point the download page to those assets only after their URLs resolve. Keep the 4.x rollback release available; do not send native files through its Tauri update feed.

Automatic installation is separate from release discovery. It needs a supported installer/update mechanism for each package type and validation of signed update metadata, interrupted installation, permissions and rollback before enabling it for users.
