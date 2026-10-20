# Native C++ / Qt app

The `cpp-rework` branch adds a C++17 application built with Qt 6 and CMake. The native Weather, Radar, History, Settings, and alert-rule screens do not need Rust or Tauri. The collector and HTTP server also build without desktop libraries for a Raspberry Pi or other server. The existing `site/` dashboard is embedded into the C++ runtime and remains available to other devices and for advanced weather tools during the migration.

This is a migration build, not a feature-parity release. Keep the existing app and a complete backup until your station and target devices have been checked. The old Rust source and release packaging are retained as a rollback path; the existing tagged release workflow still builds the old app.

## Build and run

Install CMake 3.21+, a C++17 compiler, and Qt 6.4+ Core, Network, SQL (including the SQLite driver), Widgets, and Test. Qt WebEngineWidgets is optional for embedded radar. Qt TextToSpeech enables native spoken warnings when a system voice is installed. libmosquitto 2.0+ enables native MQTT publishing and Home Assistant discovery; builds without it report that MQTT is unavailable.

Debian / Ubuntu:

```sh
sudo apt install build-essential cmake pkg-config qt6-base-dev libqt6sql6-sqlite libmosquitto-dev
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel 2
ctest --test-dir build --output-on-failure
./build/stormdesk
```

Add your distribution's `qt6-webengine-dev` package to embed radar, or pass `-DSTORMDESK_RADAR=OFF` for a smaller application that opens radar in the system browser. The main dashboard is native in either case. A WebEngine build requires the matching Chromium helper, resources, and locales at deployment.

On Windows and macOS, select a Qt desktop kit in Qt Creator, or use its `qt-cmake` wrapper with the same commands. Set `CMAKE_PREFIX_PATH` to the kit directory if CMake cannot find Qt. Deploy Qt libraries and the SQLite platform plugin using `windeployqt` / `macdeployqt`. The CMake configuration is shared across platforms; the desktop CI job collects Qt deployment folders for review; production installers are not produced by this branch yet.

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

Use a **new** volume while validating the migration. The existing Compose file references the published stable image and does not select the local native image automatically.

## Android / Fire tablets

Open `CMakeLists.txt` with a Qt for Android kit and a matching Android SDK, NDK, and JDK. Install the [Qt-recommended Android OpenSSL package](https://github.com/KDAB/android_openssl) and set `STORMDESK_ANDROID_OPENSSL_DIR` to its directory in the CMake configuration. The build packages its SSL libraries so forecast and station HTTPS requests work on devices without a system OpenSSL installation. [Qt’s Android TLS guidance](https://doc.qt.io/qt-6/android-openssl-support.html) explains the dependency. Select an ARM64 device, turn off `BUILD_TESTING`, and build the APK through Qt Creator. Qt's `qt_add_executable` creates the Android library and deployment metadata from the same C++ sources. Android does not use Qt WebEngine; the Radar page opens the system browser. The desktop tray is optional and absent on Android. Background collection and speech depend on the platform's app lifecycle; this build does not install a foreground service.

Android builds and touch behavior need validation on real tablets before distribution. Desktop CMake builds alone do not establish Android support. Qt's setup instructions are at <https://doc.qt.io/qt-6/android-getting-started.html>.

## UI size and small screens

The toolbar has a saved **70–200%** interface-size selector. It changes text, controls, cards, and embedded radar. Qt handles the monitor's DPI separately. Each device keeps its own size choice; one tablet does not resize every other screen.

At narrower widths, navigation becomes a page selector and the metric and content cards stack. Content scrolls vertically. F11 enters or leaves full screen; Escape leaves it. Automated layout checks cover 360×800, 800×480, 1280×720, 1920×1080, and 3840×2160 at 70%, 100%, 150%, and 200% size. Tests use the offscreen platform; real monitor transitions and touch accessibility still require device testing.

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

## Current coverage and remaining migration work

Implemented: location search; current forecast and ten-day outlook; Tempest UDP/cloud collection and resumable backfill; Ecowitt/WU/Ambient custom uploads; Davis polling; Ambient cloud; La Crosse cloud; history plots and daily records; CSV; backup inspection/recovery/restore; themes and scaling; official US warnings; threshold rules; ntfy/webhooks; optional MQTT/Home Assistant discovery; Home Assistant reads; CWOP and WU/PWSweather uploads; local HTTP API and screen pairing.

The browser companion retains advanced analysis, model comparisons, astronomy, maps, and dashboard customization. Those are not yet native Qt screens. Browser-only features still rely on their existing provider integrations. Native automatic updates, signed installers/APKs, legacy JSONL import, archive pruning, mDNS advertisement/discovery, the drought proxy, HTTP restore/archive replacement, and natural-voice-pack integration remain migration work. The native restore UI supports complete backups; the old browser restore workflow is not yet implemented by the C++ server.

The native app does not report these as tested integrations: real station protocols, La Crosse's unofficial cloud API, public reporting services, Android lifecycle behavior, and MQTT TLS brokers require live validation. Use test channels before enabling notifications and public uploads.

## Network access

The server listens on port 8088 by default. Viewer endpoints expose weather and location to the LAN. Settings, credentials, backups, diagnostics, integrations, and editor management require a paired bearer token or a same-origin loopback request. Pair codes expire after ten minutes, are single-use, and have a failed-attempt limit. Browser settings changes use revisions to detect conflicts. Secrets are removed from `/config-public` and the public SI API.

The home network server uses HTTP. Use it on a trusted network or behind an authenticated TLS proxy. Native settings saves do not pass through a web page. Requests and logs do not print credential-bearing provider URLs.

## Checks

`ctest` runs core data/HTTP tests and native UI layout checks. `python3 cpp/integration_smoke.py build/stormdesk` exercises the real HTTP collector and restart accounting; if `mosquitto` and `mosquitto_sub` are installed, it also checks state publishing and retained Home Assistant discovery against a disposable loopback broker. Linux x86-64/ARM64, desktop Windows/macOS, and Android ARM64 debug-APK build jobs are defined in `.github/workflows/native.yml`. A workflow definition is not evidence that those remote jobs have passed; inspect CI before publishing. The legacy release workflow remains unchanged until migration acceptance.
