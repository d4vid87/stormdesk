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

The current 4.6.1 captures use `python scripts/serve-design-preview.py 8099` with an isolated browser origin. This resets the sample station configuration on each load, labels it **Fort Worth · DEMO DATA**, and uses the actual HookEcho viewer by default. `?motion=off` opts into the recorded still-map fixture instead. The sample forecast dates follow America/Chicago, including daylight-saving changes.

The versioned `docs/stormdesk-461-*.jpg` captures are mirrored in `marketing/images/`. Desktop views are 1600×1000, phone 390×844, social 1200×630, and gauge close-ups 696×74. The README and website identify the sample data and capture date. Capture through the browser tools, inspect every view, and keep personal station settings and credentials out of public images. These assets document the shipped 4.6.1 interface; no new installer version is implied by a website-only refresh.
