// Capture a short tour from the running local StormDesk host.
const fs = require('node:fs');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  await page.goto(process.env.STORMDESK_URL || 'http://127.0.0.1:8088/', { waitUntil: 'networkidle' });
  await page.locator('.notif-x').all().then((buttons) => Promise.all(buttons.map((button) => button.click())));
  fs.mkdirSync('shots/live-marketing', { recursive: true });
  let frame = 0;
  for (const tab of ['desk', 'timeline', 'signals', 'data', 'lab']) {
    await page.locator(`.tab[data-section="${tab}"]`).click();
    await page.waitForTimeout(tab === 'lab' ? 5000 : 1800);
    for (let i = 0; i < 8; i++) {
      await page.screenshot({ path: `shots/live-marketing/frame-${String(frame++).padStart(3, '0')}.png` });
      await page.waitForTimeout(250);
    }
  }
  await browser.close();
})();
