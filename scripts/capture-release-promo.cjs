// Record genuine UI actions using the same isolated DEMO fixture as the stills.
// NODE_PATH=<Playwright node_modules> node scripts/capture-release-promo.cjs
const fs = require('node:fs');
const path = require('node:path');
const { openCapture, ROOT } = require('./capture-release-media.cjs');
const out = path.join(ROOT, 'shots/release-4121/promo');
fs.mkdirSync(out, { recursive: true });

async function main() {
  const c = await openCapture({ viewport: { width: 1920, height: 1080 }, recordVideo: out });
  const p = c.page, video = p.video(), scenes = [];
  const pause = ms => p.waitForTimeout(ms);
  const scene = async (name, work) => {
    const start = (Date.now() - c.videoStartedAt) / 1000;
    await work();
    scenes.push({ name, start, duration: (Date.now() - c.videoStartedAt) / 1000 - start });
  };
  try {
    await scene('welcome', async () => { await pause(4000); });
    await scene('customize', async () => {
      await p.locator('#desk-customize').click();
      await pause(4500);
    });
    await p.getByLabel('Arrange', { exact: true }).selectOption('gauges');
    await scene('move', async () => {
      await pause(400);
      await p.getByLabel('Move Wind earlier', { exact: true }).click(); await pause(700);
      await p.getByLabel('Move Wind earlier', { exact: true }).click(); await pause(700);
      await p.getByLabel('Navigation location', { exact: true }).selectOption('left'); await pause(700);
      await p.getByLabel('Icon position', { exact: true }).selectOption('above'); await pause(700);
      await p.getByRole('button', { name: 'Done', exact: true }).click(); await pause(1600);
    });
    await p.locator('#desk-customize').click();
    await p.getByLabel('Arrange', { exact: true }).selectOption('panels');
    await scene('panels', async () => {
      await pause(350);
      const choose = p.locator('#desk-customize-dialog select[aria-label^="Location for"]').first();
      const options = await choose.locator('option').evaluateAll(xs => xs.map(x => ({ value: x.value, selected: x.selected })));
      const target = options.find(x => !x.selected);
      if (target) await choose.selectOption(target.value);
      await pause(700);
      await p.getByRole('button', { name: 'Done', exact: true }).click(); await pause(2300);
    });
    await c.reset();
    await p.locator('#desk-customize').click();
    await p.locator('[data-customize-tab="themes"]').click();
    await scene('themes', async () => {
      await pause(1000);
      await p.locator('[data-theme-choice="violet"]').click(); await pause(1100);
      await p.locator('[data-theme-choice="abyss"]').click(); await pause(1100);
      await p.getByRole('button', { name: 'Done', exact: true }).click(); await pause(1800);
    });
    await p.locator('#gauge-style').click();
    await scene('gauges', async () => {
      await pause(2000);
      await p.locator('[data-gauge-style="neon"]').click(); await pause(1800);
    });
    await c.reset();
    await scene('forecast', async () => { await pause(3200); });
    await p.locator('.tab[data-section="lab"]').click();
    await pause(16000);
    await scene('radar', async () => { await pause(4500); });
    await c.reset();
    await scene('outro', async () => { await pause(4500); });
  } finally {
    await c.close();
  }
  const filename = await video.path();
  fs.writeFileSync(path.join(out, 'scenes.json'), JSON.stringify({ video: filename, scenes, errors: c.errors }, null, 2));
  console.log(JSON.stringify({ video: filename, scenes, errors: c.errors }, null, 2));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
