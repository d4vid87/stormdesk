# Public demo media

`hookecho-kfws-20260926.png` is the recorded HookEcho radar snapshot used in the approved design studio on September 26, 2026. The capture server labels it as recorded radar and uses synthetic Fort Worth weather and device readings. It never seeds the production app or uses real credentials.

Run `python3 scripts/serve-design-preview.py 8094` and open the printed address to reproduce the current interface. `?theme=graphite` selects a capture palette; `/selftest.html?selftest&motion=off` runs the browser assertions. Capture through the browser at desktop and phone widths. Published screenshots are in `docs/` and `marketing/images/`. The GIF and MP4 are a sequence of actual captured Weather, Radar, History, settings, and palette views.
