// Capture HookEcho's live radar loop for the marketing site.
const fs = require('node:fs');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: 1 });
  await page.goto('https://hookecho.pages.dev/#goto=KFWS,-97.3,32.6,7,bm:dark', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);
  fs.mkdirSync('shots/radar-marketing', { recursive: true });
  await page.mouse.click(332, 696);
  for (let frame = 0; frame < 24; frame++) {
    await page.screenshot({ path: `shots/radar-marketing/frame-${String(frame).padStart(3, '0')}.png` });
    await page.waitForTimeout(500);
  }
  await browser.close();
})();
