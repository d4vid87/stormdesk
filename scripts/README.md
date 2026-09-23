# Marketing captures

Serve the app with `python3 -m http.server 8094 --directory site`, then run
`NODE_PATH=/path/to/playwright/node_modules node scripts/capture-marketing.cjs` with
Playwright and Chromium installed. The script uses CI sample readings in an isolated
browser and labels its station **DEMO DATA**. HookEcho supplies the radar map.

The capture refreshes OLED Weather, Radar, History, Settings, mobile screens, and all five
theme screenshots in `docs/`; animation frames go to ignored `shots/marketing/`.
Encode the GitHub hero and website tour from those frames:

```sh
ffmpeg -y -framerate 2 -i shots/marketing/frame-%03d.png -vf 'scale=1100:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=3' -loop 0 docs/stormdesk-hero.gif
ffmpeg -y -framerate 2 -i shots/marketing/frame-%03d.png -vf 'scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=3' -loop 0 marketing/images/weather-radar-history-20260923-v2.gif
ffmpeg -y -framerate 2 -i shots/marketing/frame-%03d.png -vf 'scale=1280:-2:flags=lanczos,format=yuv420p' -c:v libx264 -crf 24 -preset medium -movflags +faststart marketing/images/weather-radar-history-20260923-v2.mp4
```

Review the screenshots before publishing. They can show the source interface ahead of a packaged release.
