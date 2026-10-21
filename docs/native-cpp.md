# Native C++ / Qt app

The `cpp-rework` branch adds a C++17 application built with Qt 6 and CMake. The dashboard and weather tools are native Qt Widgets, with HookEcho live radar embedded through optional Qt WebEngine on desktop. No Rust or Tauri toolchain is required to build StormDesk. The collector and HTTP server also build without desktop libraries for a Raspberry Pi or other server. The existing `site/` dashboard is embedded into the C++ runtime and remains available as a LAN browser companion; native screens do not depend on it.

This is a migration build pending real-device acceptance. Keep the existing app and a complete backup until your station and target devices have been checked. The old Rust source and release packaging are retained as a rollback path; the legacy Rust release workflow is manual-only. Native CI builds the C++ app for branches, pull requests, and tags.

## Build and run

Install CMake 3.21+, a C++17 compiler, and Qt 6.4+ Core, Network, SQL (including the SQLite driver), Widgets, and Test. Qt TextToSpeech enables native spoken warnings when a system voice is installed. libmosquitto 2.0+ enables native MQTT publishing and Home Assistant discovery; builds without it report that MQTT is unavailable.

Debian / Ubuntu:

```sh
sudo apt install build-essential cmake pkg-config qt6-base-dev qt6-webengine-dev libqt6sql6-sqlite libmosquitto-dev
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel 2
ctest --test-dir build --output-on-failure
./build/stormdesk
```

Radar loads HookEcho's supported `https://app.hookecho.io/?embed` view in Qt WebEngine, centered on the selected location and its nearest NEXRAD WSR-88D site. An optional site override must match a WSR-88D entry; airport TDWR sites are excluded. Radar fills the remaining Weather dashboard below a compact, collapsible native Qt instrument strip, with its color scale and controls beneath the gauges. Current conditions, animated sunrise/sunset icons and all eight gauges remain native widgets; only HookEcho uses WebEngine. Hide instruments expands the map, while official warning text stays above it. The native banner names the National Weather Service and follows the radar event colors, including white for Air Quality Alerts. The strongest alert appears first; raw severity stays in official details. Clear, loading and unavailable states use the normal neutral banner. Click the banner or focus it and press Space to open the native official warnings screen, with affected areas, full NWS descriptions and instructions, and issued/effective/expiry/end times in the device's local time. HookEcho renders its own regional alert map. The panel scrolls independently, and clicks on the map go directly to HookEcho. The dashboard no longer has a ten-day outlook or six-hour temperature chart. HookEcho supplies map controls, playback, attribution, and scan times. Internet access is required; a load failure offers reload and a browser link. Android uses Qt WebView to embed HookEcho; desktop builds without WebEngine offer the browser link explicitly. `-DSTORMDESK_WEBENGINE=OFF` builds that fallback intentionally. Synthetic `--demo` mode never loads live radar.

On Windows and macOS, select a Qt desktop kit in Qt Creator, or use its `qt-cmake` wrapper with the same commands. Set `CMAKE_PREFIX_PATH` to the kit directory if CMake cannot find Qt. Deploy Qt libraries and the SQLite platform plugin using `windeployqt` / `macdeployqt`. The CMake configuration is shared across platforms; the desktop CI job collects Qt deployment folders for review; production installers are not produced by this branch yet.

## Install a Linux desktop build

After the Release build and tests above, check the installed executable's collector paths and install it for the current user:

```sh
cmake --install build --prefix "$PWD/build-artifacts/native-linux"
python3 cpp/integration_smoke.py build-artifacts/native-linux/bin/stormdesk
cmake --install build --prefix "$HOME/.local"
update-desktop-database "$HOME/.local/share/applications"
"$HOME/.local/bin/stormdesk"
```

The install includes the executable, desktop-menu entry and icon. The desktop session's PATH must include `$HOME/.local/bin`. If an older StormDesk launcher exists, save a copy before installing; the old AppImage and its archive can remain in place. The native application uses its separate per-user data directory described below.

To package that installation without including settings or station data:

```sh
tar -C build-artifacts/native-linux -czf build-artifacts/stormdesk-native-linux.tar.gz bin share
sha256sum build-artifacts/stormdesk-native-linux.tar.gz
```

This archive uses the system's Qt, WebEngine, SQLite driver and other shared libraries. It targets machines compatible with the build host; it is not a self-contained AppImage. The same CMake install step can be repeated after an update.

## Raspberry Pi collector

Raspberry Pi OS 64-bit uses the same Debian commands. To run without a window or Qt Widgets:

```sh
cmake -S . -B build-headless -DSTORMDESK_GUI=OFF -DCMAKE_BUILD_TYPE=Release
cmake --build build-headless --parallel 2
./build-headless/stormdesk --headless --data-dir /path/to/native-data
```

`--port 8088` chooses the LAN port; `--port 0` selects a free port and prints it. `--bind 127.0.0.1` limits access to this computer. `--no-udp` disables the Tempest broadcast listener. `--browser` runs the C++ services and opens the companion dashboard. `--check` checks that the running server has a station reading less than 15 minutes old.

The root Dockerfile now builds the C++ headless runtime:

```sh
docker build -t stormdesk-native .
docker run --rm --network host -v stormdesk-native-data:/data stormdesk-native
```

Use a **new** volume while validating the migration. The Compose file builds the native image from this checkout and uses `./data-native` so it does not reuse the legacy `./data` directory. Start it with `docker compose up --build -d`.

## Android / Fire tablets

The Android dashboard uses the selected **Instrument Pocket** layout: compact current conditions, the first four ordered gauges, an animated sunrise/sunset strip, and radar filling the remaining space. Dashboard / Radar / Station / Settings navigation stays at the bottom. In landscape, temperature moves into the header and gauges simplify to labeled values, giving the short screen back to radar. The dashboard map uses a compact viewport; the Radar tab retains the complete touch controls. **Settings → Appearance** contains interface scaling, refresh, instrument ordering, history and advanced tools. All eight instrument readings remain available through Arrange instruments, with touch-sized Move up / Move down controls. The mobile scale preference is separate from the desktop preference and starts at 100%; existing station credentials, archives and gauge order are preserved. First-time station setup uses the existing native Tempest workflow.

Open `CMakeLists.txt` with a Qt for Android kit and a matching Android SDK, NDK, and JDK. Install the [Qt-recommended Android OpenSSL package](https://github.com/KDAB/android_openssl) and set `STORMDESK_ANDROID_OPENSSL_DIR` to its directory in the CMake configuration. The build packages its SSL libraries so forecast and station HTTPS requests work on devices without a system OpenSSL installation. [Qt’s Android TLS guidance](https://doc.qt.io/qt-6/android-openssl-support.html) explains the dependency. Select an ARM64 device, turn off `BUILD_TESTING`, and build the APK through Qt Creator. Qt's `qt_add_executable` creates the Android library and deployment metadata from the same C++ sources. Install the Qt WebView module alongside Qt Quick. Android embeds HookEcho through the system WebView inside a Qt Quick window container; the instruments and application controls remain native Qt widgets. The map occupies its own rectangle without overlapping native controls. A load failure offers retry and a browser fallback. The desktop tray is optional and absent on Android. Background collection and speech depend on the platform's app lifecycle; this build does not install a foreground service.

Android builds and touch behavior need validation on real tablets before distribution. Desktop CMake builds alone do not establish Android support. Qt's setup instructions are at <https://doc.qt.io/qt-6/android-getting-started.html>.

## UI size and small screens

Every native target uses the same STORMDESK header and Dashboard tab. Drag a gauge’s ⠿ handle to move it within the rail, or focus its handle and press Alt + Left/Right. The order is saved in device-local Qt preferences, survives readings/restarts, and does not rearrange another household screen. Invalid or duplicate saved entries cannot remove readings. Mouse and touch share the native handler; dropping outside the rail cancels movement.

The Instrument dashboard draws eight measurement faces and weather icons in Qt. Click an instrument for its value, source and explanation. A native sunrise/sunset strip uses today's timestamps for the selected location; its central daylight marker follows the actual time while the two endpoint icons animate decoratively. Missing sun times stay unavailable. Eight smaller gauges sit across the top on large displays, with enlarged current conditions and a glowing sunrise/sunset horizon directly below. Local context and station actions are in Settings → My station. The strip sits above the radar’s color scale, occupies at most 46% of the dashboard area, and scrolls independently when its contents need more room. Gauges reflow to four, two or one column on smaller displays. On narrow displays the instrument strip starts collapsed and opens with Show instruments. The map fills the remaining dashboard area without a separate vertical radar scroll. A large 12-hour clock with AM/PM and a smaller date occupy the upper-right header on wide displays. Forecast estimates remain labeled.

First launch offers **Connect WeatherFlow Tempest**, **Connect my station**, **Find my weather**, and **Restore a backup**. **Settings → My station → Connect station** reopens setup. Choose **Connect WeatherFlow Tempest** to go straight to the token screen, paste your personal token, and select **Import station**. A single Tempest station is selected automatically; accounts with several stations must choose one. The import fills the name, station/device IDs, sensor serial, coordinates and elevation from [WeatherFlow station metadata](https://weatherflow.github.io/Tempest/api/). No separate town search or device-ID entry is needed. Saving clears any away-place selection and uses the station’s coordinates for forecasts, US NWS warnings and the nearest NEXRAD WSR-88D radar, such as KFWS. Airport TDWR sites are excluded. The token stays in private settings; changing it invalidates previous lookup results. Missing locations or Tempest sensors block import. For other station types, choose a location and follow the source-specific steps. Tempest also offers local UDP with a serial filter; choosing cloud excludes local UDP packets. **Save and test** writes the connection settings and checks the actual feed. Missing or stale readings cannot produce a successful check. **Finish while waiting** lets you continue without claiming the connection is healthy. Setup resumes after restart if it was saved but left unfinished. The final step saves units, icon motion, warning preferences and interface size. Closing setup after saving a connection keeps those settings.

**Settings → Appearance → Icon animation** controls decorative weather and sunrise/sunset motion. Radar playback is controlled separately. The bundled Instrument typeface is derived from the existing Barlow Semi Condensed web font; its OFL license is included under `cpp/fonts/`.

The toolbar has a saved **70–200%** interface-size selector. It changes text, controls, cards, and charts. Map controls scale with the interface; map zoom is independent. Qt handles the monitor's DPI separately. Each device keeps its own size choice; one tablet does not resize every other screen.

At narrower widths, navigation becomes a page selector and the metric and content cards stack. Content scrolls vertically, and native scroll views and tables support touch scrolling. Under Tools → Customize dashboard, cards can be hidden or reordered and spacing changed. Official warnings remain visible. F11 enters or leaves full screen; Escape leaves it. Automated layout checks cover 360×800, 800×480, 1280×720, 1920×1080, and 3840×2160 at 70%, 100%, 150%, and 200% size. Linux/Windows layout tests use the offscreen platform; macOS uses its native Cocoa backend and repeats the UI suite five times. Real monitor transitions and touch accessibility still require device testing.

For a disposable, labeled preview:

```sh
./build/stormdesk --demo --port 0
QT_QPA_PLATFORM=offscreen ./build/stormdesk --demo --port 0 --screenshot native-preview.png
```

Demo mode stores synthetic readings in a temporary directory and makes no provider requests. It never opens the real archive.

## Data compatibility and rollback

The default native data directory comes from Qt's per-user application-data location, separate from the old `io.github.davidmay87.stormdesk` installation. `--data-dir` and `WD_DATA_DIR` override it. Do not run both applications against the same database; the native instance lock only coordinates native processes.

1. In the old app, export a complete `.wdbak` backup.
2. Open the native app and choose Settings → Archive & sharing → Restore….
3. Check the station and reading count before confirming. The native app saves a recovery backup before replacing its own data.
4. Restart after restoring, then check current readings, history, units, station identity, notifications, and integrations.

The SQLite `obs` columns, source markers, `meta` table, station fingerprint, JSON settings blob, and backup format 1 are preserved. Unknown settings are retained. Station changes cannot silently mix two stations in one archive. Running rain and lightning counters commit in the same transaction as the observation. Config writes are atomic. Raw history exports remain SI.

Rollback: stop the native app and reopen the old app with its original data directory. Its files have not been moved. To return native-collected history to the old app, export a native `.wdbak`, inspect it in the old app, and restore it there. Back up the old app first. Do not delete either archive until verified.

## Native tools

Weather, Radar, History, and Settings are native screens. Tools contains:

| Tool | Native behavior |
| --- | --- |
| Timeline | Observed and forecast events, category filters, configurable thresholds, merged windows, model confidence, official warnings |
| Hourly & precipitation | Temperature, rain chance/amount, wind/gusts, pressure, humidity, UV, and 15-minute guidance |
| Models & ensemble | GFS, ECMWF, ICON, GEM, regional HRRR where available; spread and GFS 10/50/90 percentiles |
| Forecast tracking | Three-hour snapshots, changes against older guidance, 24-hour temperature predictions scored against the home station |
| Astronomy & solar | Solar altitude, twilight/golden-hour crossings, daylight, moon phase and rise/set, UV, solar energy |
| Air, fire & garden | AQI/PM2.5/ozone, fire warnings, rain/dryness, reference evapotranspiration, water balance, growing degree days |
| Severe, winter & tropics | Native SPC polygon maps, instability, snow totals, NHC storms, storm report map/table, complete warnings |
| Drought | Official weekly US Drought Monitor map with pan/zoom and county severity percentages |
| Local signals | Station readings, outdoor window, airport/public Tempest lookups, nearby NWS station list, notification history |
| Almanac | All-time records, date/measurement explorer, monthly summaries, wind rose, normals, prior-year dates, NWS comparison |
| Home Assistant | Entity selection and state board; MQTT subscription board when libmosquitto is installed |
| Diagnostics | Archive/source status, device/hub packets, read-only provider checks |
| Dashboard | Card visibility/order and density; theme/accent, daylight theme, scaling, system voice and speech speed in Settings |
| Saved places | Native place search, save/remove/switch; away forecasts never get scored against the home station |

The main forecast refreshes every 15 minutes after success. Failed requests retry after 30 seconds, then 60, 120, 240 and at most 300 seconds. A successful response is saved per location in the archive and restored after restart if less than 24 hours old; its update timestamp and saved-data status remain visible. Current forecast estimates older than one hour are withheld from the dashboard. The SI API's forecast object includes `updated_at` and `status`. Tempest cloud polling keeps the last observation during a failed request and resumes on its normal ten-second polling cycle; stale readings retain their age and are not presented as fresh.

Provider requests are asynchronous, bounded, and location-aware. Tools load their providers on demand. Errors and update times remain visible alongside cached guidance. Numeric provider values remain SI internally and are converted for display. SPC, NWS warnings, county drought, and NHC have regional coverage; missing data is shown as unavailable.

Collectors support Tempest UDP/cloud and resumable backfill, Ecowitt/WU/Ambient custom uploads, Davis polling, Ambient cloud, and La Crosse cloud. Settings → My station → Import Tempest opens the same station-import setup. Davis mDNS discovery remains available. DNS-SD advertises `_stormdesk._tcp.local`; multicast discovery is best effort, and manual addresses remain available. `--no-udp` disables multicast and station UDP listeners.

The C++ server preserves the LAN API, pairing, CSV, backup download, streamed backup inspection/restore, and station archive replacement. Restore uploads are authenticated before temporary files are created, limited to 8 GB and four concurrent/staged backups, and expire after 30 minutes. Native JSONL import keeps source files and skips malformed observations. Replacing a station or restoring a backup keeps a recovery snapshot first. Existing SQLite backups remain format 1.

![Native model comparison with synthetic demonstration guidance](native-tools.png)

## Distribution and validation limits

Native CI packages Windows x64 portable ZIPs, separate Apple Silicon/Intel macOS DMGs, Linux x86-64/ARM64 AppImages and Debian packages, headless collector archives, and a release Android ARM64 APK signed using the existing upload key. Linux packages require Ubuntu 24.04 or a compatible newer runtime. Settings → App updates checks official GitHub releases on startup and at most once daily after a successful check, with a manual Check now action, a preview channel choice, and a download link when a newer native version exists. These preferences stay on the device. Legacy 4.x releases and downgrades are never offered. Installation remains explicit; binary replacement and the old Tauri update feed are not used. Speech uses the device’s installed Qt/system voices rather than legacy downloadable voice packs. MQTT requires libmosquitto 2.0+ at build time; builds without it report that the integration is unavailable. Use `mqtt://broker:1883` or `mqtts://broker:8883` and a TCP/TLS listener; a legacy browser WebSocket listener is a different transport. Topic labels and units are editable in the native Home Assistant tool.

A physical Galaxy S24 Ultra running Android 16 has verified the signed APK, actual Tempest import/readings/forecast, automatic KFWS selection, NWS banner color, touch gauge movement, restart/upgrade persistence, onboarding, saved text sizing, dropdown placement and live release checks. The Android build uses Qt 6.10.2 with NDK 27.2.12479018. The Linux Wayland app also receives actual station observations. Physical Windows/Mac/Pi acceptance, Android rotation/audio/every tool, other station hardware, La Crosse’s unofficial API, public reporting uploads, MQTT TLS, multicast and monitor transitions remain unverified. Windows signing and Mac notarization are prepared but require the owner's vendor accounts/certificates; current previews remain unsigned/not notarized. See [native release acceptance](native-release-readiness.md). Test notification/reporting destinations before using live services.

## Network access

The server listens on port 8088 by default. Viewer endpoints expose weather and location to the LAN. Settings, credentials, backups, diagnostics, integrations, and editor management require a paired bearer token or a same-origin loopback request. Pair codes expire after ten minutes, are single-use, and have a failed-attempt limit. Browser settings changes use revisions to detect conflicts. Secrets are removed from `/config-public` and the public SI API.

The home network server uses HTTP. Use it on a trusted network or behind an authenticated TLS proxy. Native settings saves do not pass through a web page. Requests and logs do not print credential-bearing provider URLs.

## Checks

`ctest` runs core data/HTTP tests and native UI layout checks, including selected-place radar links, missing sun times, pause behavior, radar geometry below the native instrument strip, collapse behavior, clock sizing and map input. Tempest checks cover metadata validation, device selection, elevation, token changes, imported coordinates for warning requests, and NEXRAD selection that excludes airport TDWR sites. Controlled provider-response tests cover forecast retry timing, saved-response validation, location changes, Tempest cloud failure/recovery and a fresh service instance reopening the saved station configuration and archive. Banner mouse/keyboard tests verify navigation and the complete alert metadata. These tests do not disconnect physical station hardware. The UI suite uses the no-WebEngine fallback to avoid external network/GPU dependencies; the embedded browser and live scans require a separate live desktop smoke check. `python3 cpp/integration_smoke.py build/stormdesk` exercises the real HTTP collector, restart accounting, SI packet shape, a backup over the normal request limit, streamed inspection, restore/recovery, and rejected unsafe archive requests; if `mosquitto` and `mosquitto_sub` are installed, it also checks state publishing and retained Home Assistant discovery against a disposable loopback broker. Linux x86-64/ARM64, desktop Windows/macOS, and Android ARM64 release-APK build jobs are defined in `.github/workflows/native.yml`. A workflow definition is not evidence that those remote jobs have passed; inspect CI before publishing. Legacy release packaging is retained behind a manual trigger for rollback. Native jobs do not install Rust. `scripts/build-appimage.sh` packages the native app with checksum-verified linuxdeploy/Qt tools; `scripts/AppImage.Dockerfile` provides its Ubuntu 24.04 build environment. The KDE 6.10 Flatpak manifest also builds the same native Qt code; its workflow pins each bundle to the source commit. The container workflow builds the C++ headless image for AMD64 and ARM64 and publishes the `5.0.0-preview.3` multi-architecture tag without replacing the legacy `latest` tag. Native packages use a separate native data directory. Export/import a backup when moving from legacy 4.x; leave that installation in place until verified.
