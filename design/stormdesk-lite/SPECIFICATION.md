# Stormdesk Lite

Stormdesk Lite is the focused StormDesk interface at `/lite/`. It uses the same weather providers, station adapters, archive, alert engine, access controls, backup format, and integrations as full StormDesk.

## User experience

- **Today** shows official warnings, current conditions, source age, six upcoming hours, five forecast days, and station connection status.
- **Forecast** switches between the next 24 hours and ten days.
- **Radar** requests a still image only when opened and loads the interactive HookEcho viewer only after Play.
- **More** opens the existing StormDesk station health, timeline, history, alert rules, integrations, backup, and access tools. These modules never load during Lite startup.
- Appearance follows the device by default. Light and Dark overrides and US/metric units are saved per browser.
- Current readings retain their last value and display their age. Missing station fields say “Unavailable”; numeric zero remains zero.

## Data and station behavior

Forecast-only users search for a town or ZIP code. The page resolves it through the existing geocoder, loads Open-Meteo forecasts, and loads NWS warnings for supported US points.

On a StormDesk host, Lite reads the versioned `/api/v1` snapshot and overlays the latest normalized station observation. Every existing ingest adapter continues to feed that snapshot and archive: Tempest, Ecowitt/Wittboy, Ambient Weather, Weather Underground protocol, WeeWX, Davis WeatherLink Live, Ambient Weather Network, AcuRite/`rtl_433`, and La Crosse.

Tempest and Ecowitt have guided Lite setup. Other station families open the full tested setup because their provider-specific fields and diagnostics already live there. A protected host asks the Lite browser for the existing six-digit pairing code before accepting station changes.

## Deployment model

- `app.mystormdesk.com/lite/` provides hosted forecast-only use and browser-local cloud station credentials.
- Desktop, Docker, and headless StormDesk builds serve `/lite/` beside the full dashboard. Credentials, collection, archives, alert rules, notifications, MQTT, Home Assistant, backup, and export remain on that host.
- Remote household browsers authenticate with revocable editor tokens. `/config-public` supplies a redacted read-only view.
- The stable `/api/v1` contract exposes named SI fields without credentials. Lite converts them only for display.

The existing one-station-per-host storage model remains. Multi-user hosted station storage is intentionally unnecessary: owners who need durable collection use their private StormDesk host, while the public hosted interface works without an account.

## Accessibility and compatibility

The interface uses native buttons, inputs, selects, links, and dialogs; visible focus; labeled controls; reduced-motion handling; and responsive layouts for phone, tablet, and desktop widths. System fonts and dependency-free HTML, CSS, and JavaScript keep the runtime portable.

Hardware performance benchmarking is excluded at the owner's request.
