# Marketing captures

Serve the app with `python3 -m http.server 8094 --directory site`, then run
`node scripts/capture-marketing.cjs` with Playwright available and Chromium installed.
The script reuses CI forecast samples, intercepts sample station requests in an isolated browser,
and labels every view **DEMO DATA**. HookEcho's embedded radar remains real.

Screenshots go to `docs/`; intermediate animation frames go to ignored `shots/marketing/`.
Encode the GitHub hero with:

```sh
ffmpeg -y -framerate 2 -i shots/marketing/frame-%03d.png \
  -vf 'scale=1100:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160[p];[b][p]paletteuse=dither=bayer:bayer_scale=3' \
  -loop 0 docs/stormdesk-hero.gif
```

Review each screenshot before committing. These source previews can precede a packaged release.
