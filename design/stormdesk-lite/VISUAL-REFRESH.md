# Polished weather preview and Tempest repair

Review the separate clickable preview at https://app.mystormdesk.com/lite/preview/ . The production interface remains at /lite/.

The preview uses original inline SVG, warm white/slate surfaces, amber accents, large readings, a dedicated measurement row, and labeled sample states. Appearance follows the device unless changed. Today, Forecast, Radar and More are interactive; radar links to the production viewer without loading it in the mockup. No credentials or weather requests are made by the preview.

## Observation repair

Lite requests Tempest station observations independently of forecasts, every 60 seconds while visible and on return. Saved observation values survive provider failure and reload; forecast and station caches are separate and keyed by station/location and units. Readings are labeled Live, Delayed after five minutes, Offline on failure, or Waiting before a first reading. Missing station measurements stay unavailable. Browsing another town uses a saved place and exposes Return to my station without overwriting station identity. Station metadata repairs coordinates overwritten by the earlier URL parsing bug.

## Validation

- `node scripts/check-lite-readings.mjs`: observations override forecast measurements; missing and zero values differ; station and forecast outages are independent; last readings persist; town browsing preserves station identity; missing/invalid URL coordinates are ignored and valid zero coordinates work.
- Lite rendered-state and browser compatibility checks pass.
- Preview rendered at 360, 768 and 1366 pixels in light/dark themes. Desktop and mobile sample screenshots are in `docs/stormdesk-lite-preview-*.png`.
- Native labeled controls and visible focus styling support keyboard navigation.
- The user's open hosted browser showed Connect station, so private Tempest readings could not be compared with a live authenticated response. Connect Tempest on that origin to complete that account-specific check. No credentials were read or logged.
- Performance benchmarking was excluded as requested.
