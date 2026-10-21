# Native release acceptance

The 5.0 packages remain previews. A successful CI build is not physical-device acceptance.

## Installed Android Instrument Pocket candidate

The signed APK built from `199a4fa3ef104c9aeaffd22847300e3b78169a53` in [native CI run 39689167725](https://github.com/d4vid87/stormdesk/actions/runs/39689167725) was installed as an upgrade on the Galaxy S24 Ultra / Android 16. Public preview.2 download assets have not been replaced.

- Native current conditions, four ordered gauges, animated sunrise/sunset and bottom navigation use the selected Instrument Pocket layout. All eight gauges remain available through Settings → Appearance → Arrange instruments.
- Actual Tempest observations were recent, KFWS was selected automatically, and HookEcho displayed the matching white Air Quality Alert boundaries inside the dashboard. The full Radar page uses the provider's touch interface.
- The signed candidate passed size-picker selection from 115% to 100%, dashboard return from Settings and a gauge-details dialog, full Radar navigation and return, portrait/landscape, and restart with station configuration, gauge order and 100% sizing retained. Touch ordering was exercised during implementation. Local core/UI tests include the mobile layout and picker model-change guards.
- The dashboard radar uses a compact viewport. Android recreates its WebView when returning to a hidden page to avoid a blank cached Qt surface; this reloads and recenters the radar. Loading/error feedback and the browser fallback remain available.
- Physical acceptance is limited to this phone and the interactions above. Every advanced tool, other Android devices and extended offline/background operation remain unchecked.

## Published preview.2 evidence

- Linux: core/UI and collector/API/backup/MQTT integration checks pass. A packaged AppImage has received actual station observations on Wayland.
- Android: the signed ARM64 APK installs beside the legacy app on a Galaxy S24 Ultra running Android 16. Native token onboarding imports the actual Tempest station and receives live observations and forecasts, with KFWS selected automatically. Setup uses the main application surface and complete frame repaints; scrolling and screen changes no longer retain old pixels on this device. Touch gauge order, station settings and 70% text sizing survive app restart and APK upgrades. Both 70% and 200% scaling were exercised. Qt 6.10.2 corrects the dropdown touch offset observed with Qt 6.8.3. The final signed APK's page and scale dropdowns clear the system bars, including at 200%, and selecting the visible Dashboard row returns to the correct page. The live GitHub release check succeeds. Reopened token onboarding reaches a fresh reading and the finish screen with each step starting at the top. HookEcho opens in the system browser with KFWS and the matching white Air Quality Alert boundary.
- Windows, macOS and Raspberry Pi: builds are checked in CI; physical-device checks remain outstanding.
- Windows signing and Apple notarization: credentials are not configured in the repository. The CI signing path remains unverified with real certificates.
- Updates: the app checks official GitHub releases and links to a newer native release. It does not replace its own binary or use the legacy Tauri updater.

## Device checks before stable

On each supported device, start with an existing archive backup and retain the previous app.

1. Complete onboarding with a real Tempest token. Verify that the station, coordinates, warnings and NEXRAD WSR-88D selection match the station. Never save tokens or precise coordinates in public reports.
2. Confirm an actual current observation and forecast. Check stale/offline states without presenting old observations as fresh.
3. Exercise every onboarding transition, keyboard entry, scrolling and reopening setup. No retained pixels, clipped fields or inaccessible buttons are acceptable.
4. Move gauges with touch/mouse and verify the order after a new reading and restart. Verify scale changes, portrait/landscape, and system-bar clearance. On Android run `python3 scripts/check-android-insets.py` with that device selected through `ANDROID_SERIAL`. Qt 6.10 uses a full-screen edge-to-edge rendering surface, so this surface-only check reports overlap even when the content is inset; it cannot prove content clearance. Inspect the dashboard, keyboard, onboarding and dropdowns against the visible system bars on the device.
5. Verify radar navigation, station location and NWS banner event colors. The installed Instrument Pocket candidate embeds radar; the published preview.2 APK opens it in the system browser. Verify both dashboard and full Radar page, including return from Settings and dialogs.
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
