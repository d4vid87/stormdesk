// The desktop/Android window, and nothing else. Everything this file needs from the LAN server
// it gets through `start_services`, so the headless build never compiles any of it.

use tauri::{WebviewUrl, WebviewWindowBuilder};
use std::sync::atomic::{AtomicBool, Ordering};

static FRONTEND_READY: AtomicBool = AtomicBool::new(false);

fn should_open_fallback(ready: &AtomicBool) -> bool { !ready.swap(true, Ordering::Relaxed) }

#[tauri::command]
fn frontend_ready() { FRONTEND_READY.store(true, Ordering::Relaxed); }

#[cfg(target_os = "linux")]
fn validate_speech(text: &str) -> Result<(), String> {
    if text.trim().is_empty() || text.len() > 4096 || text.contains('\0') {
        return Err("Speech must contain 1–4096 bytes of plain text".into());
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn speech_result(success: bool, diagnostics: &str) -> Result<(), String> {
    // eSpeak can return zero even when its audio device could not open.
    if success && diagnostics.trim().is_empty() { Ok(()) }
    else { Err(format!("Speech engine failed. Check your audio output. {}", diagnostics.trim())) }
}

#[tauri::command]
async fn speak_text(text: String) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        validate_speech(&text)?;
        tauri::async_runtime::spawn_blocking(move || {
            use std::io::{Read, Write};
            use std::process::{Command, Stdio};
            // One system voice at a time, including concurrent invocations from the UI.
            static SPEECH: std::sync::Mutex<()> = std::sync::Mutex::new(());
            let _guard = SPEECH.lock().map_err(|_| "Speech engine busy")?;
            let mut child = Command::new("espeak-ng")
                .args(["--stdin", "-v", "en-us"])
                .stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::piped())
                .spawn().map_err(|e| if e.kind() == std::io::ErrorKind::NotFound {
                    "Install espeak-ng using your package manager, then test voice again".to_string()
                } else { format!("Could not start speech engine: {e}") })?;
            let stderr = child.stderr.take().ok_or("Speech diagnostics unavailable")?;
            let diagnostics = std::thread::spawn(move || {
                let mut bytes = Vec::new();
                let mut input = stderr;
                let mut chunk = [0; 1024];
                // Drain the pipe to avoid blocking the child, retaining only a bounded message.
                while let Ok(n) = input.read(&mut chunk) {
                    if n == 0 { break; }
                    let keep = n.min(4096usize.saturating_sub(bytes.len()));
                    bytes.extend_from_slice(&chunk[..keep]);
                }
                String::from_utf8_lossy(&bytes).into_owned()
            });
            if let Err(e) = child.stdin.take().ok_or("Speech input unavailable")?.write_all(text.as_bytes()) {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("Speech input failed: {e}"));
            }
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(180);
            loop {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        let message = diagnostics.join().unwrap_or_default();
                        return speech_result(status.success(), &message);
                    }
                    Ok(None) if std::time::Instant::now() < deadline => std::thread::sleep(std::time::Duration::from_millis(50)),
                    result => {
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err(format!("Speech engine stopped: {}", result.err().map(|e| e.to_string()).unwrap_or_else(|| "timed out".into())));
                    }
                }
            }
        }).await.map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "linux"))]
    { let _ = text; Err("Native speech fallback is available on Linux only".into()) }
}

// The tray, the server and the paths behind them are desktop-only, and so is everything imported
// for them — Android builds warn about each one otherwise.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri_plugin_notification::NotificationExt;

/// The current temperature, next to the clock, without a window in the way. Linux app
/// indicators quietly drop tooltips, so the same string goes in the title too — on ayatana that
/// is what actually shows, and on Windows and macOS the tooltip is.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn tray_label(state: &std::sync::Arc<crate::server::State>, cfg_path: &std::path::Path) -> Option<String> {
    let raw = state.packets.lock().ok()?.get("obs_st")?.clone();
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let c = v.pointer("/obs/0/7")?.as_f64()?;
    let metric = crate::setting(cfg_path, "units").as_deref() == Some("metric");
    Some(if metric {
        format!("StormDesk — {c:.1} °C")
    } else {
        format!("StormDesk — {:.1} °F", c * 9.0 / 5.0 + 32.0)
    })
}

// Update checks go through our own commands rather than the plugin's JavaScript API: the
// frontend has no build step and no npm packages, so the only JS it can rely on is `invoke`.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
async fn updater_check(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_updater::UpdaterExt;
    // Flatpak installs are updated by Flatpak; writing into /app would fail anyway.
    if std::path::Path::new("/.flatpak-info").exists() {
        return Ok(None);
    }
    // On Linux the updater plugin can only install an AppImage. A .deb (or anything else)
    // install has no $APPIMAGE, so be honest instead of offering an install that cannot work.
    #[cfg(target_os = "linux")]
    if std::env::var("APPIMAGE").is_err() {
        return Err("updates for this install come through your package manager (apt upgrade stormdesk), not the in-app updater".into());
    }
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    Ok(update.map(|u| u.version))
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
async fn updater_install(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    #[cfg(target_os = "linux")]
    if std::env::var("APPIMAGE").is_err() {
        return Err("updates for this install come through your package manager (apt upgrade stormdesk), not the in-app updater".into());
    }
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or("no update available")?;
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    app.restart();
}

pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder
            // Registered first, per the plugin's docs, so a second launch exits here before any
            // other plugin has run. Without this, relaunching while an instance was running tore
            // down the old UI process, and its WebKit web process — busy in JS — missed the
            // shutdown watchdog's deadline and died SIGTRAP. The second launch now just focuses
            // the window that already exists.
            .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }))
            .plugin(tauri_plugin_updater::Builder::new().build())
            .invoke_handler(tauri::generate_handler![updater_check, updater_install, frontend_ready, speak_text]);
    }

    builder = builder.plugin(tauri_plugin_notification::init());

    builder
        .setup(|app| {
            #[allow(unused_mut)]
            let mut win = WebviewWindowBuilder::new(app, "main", WebviewUrl::default());
            #[cfg(target_os = "linux")]
            let fallback_port;

            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                let data_dir = app.path().app_data_dir().unwrap_or_else(|_| crate::default_data_dir());
                let cfg_path = app
                    .path()
                    .app_config_dir()
                    .map(|d| d.join("config.json"))
                    .unwrap_or_else(|_| crate::default_config_dir().join("config.json"));
                let (state, port) = crate::start_services(data_dir, cfg_path.clone());
                #[cfg(target_os = "linux")]
                { fallback_port = port; }

                let show = MenuItem::with_id(app, "show", "Show StormDesk", true, None::<&str>)?;
                let refresh = MenuItem::with_id(app, "refresh", "Refresh", true, None::<&str>)?;
                let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show, &refresh, &quit])?;
                let tray = TrayIconBuilder::new()
                    .icon(app.default_window_icon().cloned().unwrap())
                    .menu(&menu)
                    .tooltip("StormDesk")
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "quit" => app.exit(0),
                        "refresh" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.eval("location.reload()");
                            }
                        }
                        _ => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                    })
                    .build(app)?;

                let (tray_state, tray_cfg) = (state.clone(), cfg_path);
                std::thread::spawn(move || loop {
                    if let Some(label) = tray_label(&tray_state, &tray_cfg) {
                        let _ = tray.set_tooltip(Some(&label));
                        let _ = tray.set_title(Some(&label));
                    }
                    std::thread::sleep(std::time::Duration::from_secs(60));
                });

                // The window loads through Tauri's own asset protocol, not the LAN server: the
                // server's port moves when the configured one is taken, and WebKit keys
                // localStorage per origin, so a moving port would wipe the token and layout on
                // every restart.
                win = win
                    .title(format!("StormDesk — tablet: http://{}:{}", crate::server::lan_ip(), port))
                    .inner_size(1280.0, 800.0)
                    // Start maximized on Linux: KWin maximizes a restored window after mapping
                    // it, and GTK can miss that configure entirely — the webview then paints at
                    // the startup size in the corner of a full-screen window, with no way for
                    // the process to notice. Owning the state from the first frame sidesteps it.
                    .maximized(cfg!(target_os = "linux"))
                    // the window isn't same-origin with the LAN server, so it needs the port told to it
                    .initialization_script(format!(
                        "window.__WD_UDP='http://localhost:{port}/udp';window.__WD_SRV='http://localhost:{port}';{};addEventListener('DOMContentLoaded',()=>window.__TAURI__?.core?.invoke('frontend_ready'));",
                        crate::server::ver_script()
                    ));
            }

            win.build()?;

            #[cfg(target_os = "linux")]
            {
                let app = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(20));
                    if !should_open_fallback(&FRONTEND_READY) { return; }
                    eprintln!("stormdesk: native window did not become ready; opening browser dashboard");
                    let _ = crate::open_browser(fallback_port);
                    let _ = app.notification().builder()
                        .title("StormDesk opened in your browser")
                        .body("The native window could not start on this graphics driver.")
                        .show();
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error running StormDesk");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "linux")]
    #[test]
    fn speech_input_is_bounded_plain_text() {
        assert!(validate_speech("Tornado Warning. This is a test.").is_ok());
        assert!(validate_speech("--help; $(id)").is_ok()); // stdin text, never shell arguments
        assert!(validate_speech("").is_err());
        assert!(validate_speech("\0").is_err());
        assert!(validate_speech(&"x".repeat(4097)).is_err());
        assert!(speech_result(true, "").is_ok());
        assert!(speech_result(true, "error: Host is down").is_err());
        assert!(speech_result(false, "").is_err());
    }

    #[cfg(target_os = "linux")]
    #[test]
    #[ignore = "plays labeled test speech through the system audio output"]
    fn linux_voice_smoke() {
        tauri::async_runtime::block_on(speak_text("StormDesk Linux voice test. This is only a test of spoken watches and warnings.".into())).unwrap();
    }

    #[test]
    fn frontend_readiness_opens_the_fallback_once() {
        let ready = AtomicBool::new(false);
        assert!(should_open_fallback(&ready), "a timed-out frontend opens the browser");
        assert!(!should_open_fallback(&ready), "the same launch cannot open a second tab");
        let ready = AtomicBool::new(true);
        assert!(!should_open_fallback(&ready), "a ready frontend keeps the native window");
    }
}
