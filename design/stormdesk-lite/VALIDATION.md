# Stormdesk Lite validation

## Completed checks

- Live Lite JavaScript parses without bundling or third-party dependencies.
- Forecast-only startup, location search, weather refresh, cached fallback, unit conversion, and theme selection use the existing provider and settings modules.
- Server mode reads normalized observations from `/api/v1`; stale observations remain visible and missing values stay unavailable.
- NWS warning text is treated as text, not executable markup.
- Tempest credentials are validated before they are saved. Ecowitt setup verifies that a StormDesk host is present.
- Protected hosts support the existing pairing-code flow and revocable editor token.
- Radar does not request its still image until Radar opens, and the interactive iframe is created only after Play. Leaving Radar destroys the iframe.
- Advanced destinations route to the existing full StormDesk implementations without initializing them in Lite.
- Browser compatibility, Lite rendered-state checks, Rust tests, and the existing nine-screen CI self-test pass.

## Operational checks after deployment

- `https://app.mystormdesk.com/lite/` returns the production Lite interface.
- `https://mystormdesk.com/lite` redirects to that interface.
- The marketing homepage links to Lite and serves its screenshot and GIF assets.
- The repository and deployment remain reproducible from `main`.

Hardware performance validation is excluded from completion.
