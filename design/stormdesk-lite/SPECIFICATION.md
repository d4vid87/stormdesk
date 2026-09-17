# Stormdesk Lite design specification

## Product intent

Stormdesk Lite is a separate, lightweight StormDesk edition for weather-station owners and people who only need local weather. It fixes the current product's slow startup, setup friction, and crowded dashboard while preserving access to advanced capabilities.

The browser interface is shared by personal self-hosted installs and a hosted multi-user service. A 4 GB Intel Celeron Chromebook is the minimum display target. It is never required to act as a station collector.

## Experience

The first visit asks for a town or ZIP code and immediately opens a forecast-only dashboard. No account or station is required. The fixed primary navigation contains Today, Forecast, Radar, and More.

- **Today:** active official warning, current temperature and condition, feels-like and high/low, wind, humidity, rain, six hourly periods, five daily cards, source age, and a station-connection invitation.
- **Forecast:** hourly and 10-day modes.
- **Radar:** a current still image. Playback is initialized only after the user presses Play and stops when Radar is hidden.
- **More:** station details, history and analysis, timeline and local signals, alert rules, integrations, backup/export, account, and settings. Each advanced area loads only when opened.

Slate neutrals and amber accents identify the product. System fonts avoid a startup request. Appearance follows the device by default, with explicit Light and Dark overrides. The interface uses a fixed responsive layout with no panel moving or resizing and no decorative weather animation.

## Station setup

Setup starts only after weather is visible. The four steps are station family, connection instructions, connection check, and first-reading confirmation.

- Tempest demonstrates a cloud connection using a personal token and station ID.
- Ecowitt/Wittboy demonstrates local upload through Stormdesk Connector. The instructions explain the always-on computer requirement before installation.
- Ambient Weather, Weather Underground protocol devices, WeeWX, Davis WeatherLink Live, Ambient Weather Network, AcuRite via `rtl_433`, and La Crosse appear with cloud, direct-upload, or connector requirements.

Invalid credentials identify the rejected fields and their source. An unreachable connector asks the user to check its process, local network, and firewall. A successful connection can wait for the first observation without inventing values. Missing measurements display as unavailable; numeric zero remains zero.

The first release demonstrates one station per owner. It must not suggest that every station reports battery, lightning, rain, UV, or other optional measurements.

## Architecture boundaries

| Boundary | Responsibility | User-visible failure state |
|---|---|---|
| Location lookup | Resolve a US town or ZIP to a display name and coordinates | Keep the form open and ask for a more specific location |
| Weather summary | Return current conditions, hourly/daily forecast, provider, and observation age | Show the last cached result as stale; identify unavailable sections |
| Station setup/status | Describe connection requirements, validate credentials or connector reachability, and report the first observation | Invalid credentials, connector unreachable, or waiting for first reading |
| History | Query server-owned station observations by time range and metric | Preserve selected range and offer retry |
| Alerts | Return official alerts and evaluate owner-defined rules on the server | Show last update time and mark delayed data |

The server or local connector owns credentials, collection, archives, and alert processing. Browsers receive display-ready data and never collect LAN broadcasts. Shared hosting requires authenticated administration and tenant-isolated station records; public forecast browsing remains anonymous. Local-only hardware reports through the optional connector. Existing StormDesk station adapters should be reused behind these boundaries.

Production wire formats, authentication protocol, infrastructure, live provider selection, and deployment are deliberately outside this prototype.

## Capability map

| Capability | Lite destination | Runtime requirement |
|---|---|---|
| Current station readings | Today / Station details | Cloud adapter or local connector |
| Forecast and official warnings | Today / Forecast | Server-side public providers |
| Radar | Radar | Still image; viewer loaded on Play |
| Timeline and nearby signals | More | Server processing; station optional |
| History, charts, records, rain totals | More | Server archive and connected station |
| Custom alert rules and push | More | Always-on server or connector |
| Home Assistant, MQTT, webhooks | More | Self-hosted server or connector |
| Backup and CSV export | More | Server archive |
| Layout editing and decorative animation | Excluded | — |

## States and accessibility

Forecast-only, connected-station, stale-data, and severe-warning states are required. Every reading identifies its source and age. Stale data remains visible with an explicit stale label. Severe warnings appear before current conditions and open into a focused detail dialog.

All controls use native buttons, inputs, selects, and dialogs; support keyboard navigation; retain a visible focus indicator; and meet WCAG AA contrast. Touch targets are at least 42 CSS pixels. Layouts must work without horizontal page scrolling at 360, 768, and 1366 CSS pixels.

## Performance targets

The production implementation should show useful cached weather within one second and the first uncached weather within three seconds on a 4 GB Celeron Chromebook over a 10 Mbps connection, assuming healthy providers. Radar, history, charts, integrations, and analysis must not initialize during startup. These are proposed targets and require measurement in the production build.

Defaults are US coverage, US customary units, device-following appearance, Oklahoma City sample weather, and one connected station per owner.
