# Marketing captures

Serve the app with `python3 -m http.server 8094 --directory site`, then run
`NODE_PATH=/path/to/playwright/node_modules node scripts/capture-marketing.cjs` with
Playwright and Chromium installed. The script uses CI sample readings in an isolated
browser and labels its station **DEMO DATA**. HookEcho supplies the radar map.

The capture refreshes Graphite Silver Weather, Radar, History, forecast, welcome,
Settings, mobile screens, and all ten dark palettes plus classic theme screenshots
in `docs/`; animation frames go to ignored `shots/marketing/`. Copy the screenshots
used by the website into `marketing/images/`.
Encode the GitHub hero and website tour from those frames:

```sh
ffmpeg -y -framerate 2 -i shots/marketing/frame-%03d.png -vf 'scale=1100:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=3' -loop 0 docs/stormdesk-hero.gif
cp docs/stormdesk-hero.gif marketing/images/stormdesk-hero.gif
ffmpeg -y -framerate 2 -i shots/marketing/frame-%03d.png -vf 'scale=1280:-2:flags=lanczos,format=yuv420p' -c:v libx264 -crf 24 -preset medium -movflags +faststart marketing/images/stormdesk-tour.mp4
```

Review the screenshots before publishing. They can show the source interface ahead of a packaged release.

The earlier 4.6.1 captures used `python scripts/serve-design-preview.py 8099` with an isolated browser origin and a **Fort Worth · DEMO DATA** station label. The sample forecast dates follow America/Chicago, including daylight-saving changes.

For current captures, run this from the repository root, then open the printed local URL in the browser:

```sh
python3 scripts/serve-design-preview.py 8145
```

The helper serves a temporary copy of `site/` on loopback and resets its sample configuration on every page load. It does not edit the source app or use personal station settings or credentials. Forecast & sky is the default view; `?view=radar` opens the actual HookEcho iframe. Use `?theme=graphite` (or `violet`, `carbon`, `abyss`, `spruce`, `oxblood`, `copper`, `indigo`, `petrol`, `espresso`, `blue`, `light`, `oled`, `contrast`, or `eink`) to capture existing app themes. Combine options with `&`. `?view=radar&motion=off` uses the labelled September 26, 2026 recorded HookEcho still instead of the live viewer.

All station readings, forecast, historical readings, model estimates, and intercepted NWS/NOAA outlook responses are illustrative **DEMO DATA**, not actual provider records or current weather. The ten-day forecast includes matching sun, cloud, rain, and thunderstorm conditions; hourly timestamps are whole hours and temperatures follow a local day/night cycle. Model soil readings are estimates; nearby observation reports and unprovided archive products may remain unavailable. HookEcho's live radar is separate from these fixtures and can show a different region. Identify that region and the capture date when publishing.

To reproduce a selected live HookEcho scene, save its full `https://app.hookecho.io/#scene=...` URL as a plain-text file outside the repository and restart the helper with:

```sh
STORMDESK_CAPTURE_RADAR_SCENE=/absolute/path/radar-scene-url.txt \
  python3 scripts/serve-design-preview.py 8145
```

Then open `http://127.0.0.1:8145/?view=radar`. The helper validates the HookEcho URL and uses it verbatim in the temporary app's radar iframe. No screenshot is substituted for live radar; the `motion=off` still behavior is unchanged. Omit the environment variable to use the app's normal radar location. Restart after changing the scene file or helper, and keep opaque scene URLs out of commits.

Historical `docs/stormdesk-461-*.jpg` captures remain mirrored in `marketing/images/`. Desktop views are 1600×1000, phone 390×844, social 1200×630, and gauge close-ups 696×74. They document the shipped 4.6.1 interface.

The historical 4.10.0 Balanced Desk screenshot is `docs/stormdesk-4100-balanced.jpg`, mirrored in `marketing/images/`, at 1610×1132. It combines demo station readings with forecast and regional data for illustration, captured November 1, 2026. It is not current weather.

The first 4.11.0 Observatory preview, `docs/stormdesk-4110-observatory.jpg` (1662×1161), remains as an earlier capture. The current website and README use the November 17, 2026 `stormdesk-4110-weather`, `radar`, `history`, `settings`, and theme captures: 1662×1164 desktop, 390×844 mobile, and 1631×138 eight-gauge strips. These are mirrored in `docs/` and `marketing/images/`. The Lite social image, `stormdesk-lite-desktop.png`, was also recaptured from the current Lite interface with demo data.

The full HookEcho viewer shows real MRMS reflectivity over Florida and the Gulf, captured November 17 around 4:52 PM CST. It is separate from the Fort Worth demo station, and published media is recorded, not current weather. The radar capture is a paused live field, not a fabricated timelapse. Capture through the browser tools, inspect every view, and keep personal station settings and credentials out of public images. A website-only media refresh does not imply a new installer release.

The matching `stormdesk-4110-promo.mp4` is a 30-second, 1920×1080 H.264/AAC video with faststart (about 3 MB). The hero GIF is a 12-second, 960×540 loop (about 4.7 MB); the social poster is 1200×630. The website provides an English WebVTT caption track, transcript, playback controls, and a still-image fallback for reduced motion. GitHub links to the same narrated tour.

Narration was generated locally with the preexisting [Kokoro-82M v1.0 ONNX](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) model (Apache-2.0), voice `af_heart`, using `kokoro-onnx` 0.6.1 (MIT). It is disclosed as AI-generated, with no cloned personal voice. The source speech was normalized to −16.07 LUFS / −1.50 dBTP. Video duration, full decode, faststart order, media dimensions, browser playback, and visible captions were verified; no human headphone audition was performed.
