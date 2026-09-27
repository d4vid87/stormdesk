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

The current browser captures also use `serve-design-preview.py` for isolated, labeled sample data and a recorded HookEcho map. Settings captures include the six-card home, Appearance page, and phone home. The tour includes the new settings views.
