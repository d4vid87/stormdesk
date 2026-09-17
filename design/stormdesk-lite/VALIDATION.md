# Stormdesk Lite prototype validation

## Verified prototype behavior

- Today, Forecast, Radar, and More navigation works with keyboard-accessible native controls.
- Location text, hourly/10-day selection, warning details, station setup, unit conversion, and System/Light/Dark appearance are interactive.
- Tempest and Ecowitt setup paths demonstrate success, invalid credentials, connector failure, and waiting for a first reading without network requests or stored credentials.
- Forecast-only, connected-station, stale-data, and severe-warning states can be selected from **Demo states**.
- Radar begins as a still sample, animates only after Play, honors reduced-motion preferences, and stops when another destination opens.
- Advanced areas remain representative on-demand previews and do not initialize at startup.
- The interface uses local sample data, system fonts, no framework, no remote assets, and no live map or weather dependency.

## Production work still requiring validation

- Measure cached and uncached startup targets on a real 4 GB Celeron Chromebook and 10 Mbps connection.
- Test WCAG AA contrast and screen-reader output with the final production design tokens and content.
- Run the production interface at 360, 768, and 1366 CSS pixels in current Chrome, Safari, Firefox, and Edge.
- Exercise live provider outages, stale cache recovery, tenant isolation, connector upgrades, station-specific missing fields, and real alert delivery.
- Validate every reused station adapter against supported hardware or captured protocol fixtures.

Open `index.html` in any modern browser. No server or build step is required.
