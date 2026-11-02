import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const expected = {
  weather: { src: 'images/stormdesk-4100-balanced.jpg', version: '4.10.0', caption: /^Balanced Desk · demo station readings; forecast and regional data shown for illustration\. Captured November 1, 2026\. Not current weather\.$/ },
  radar: { src: 'images/stormdesk-461-radar.jpg', version: '4.6.1', caption: /^Radar \/ StormDesk 4\.6\.1\..*Recorded interface; not live radar\.$/ },
  history: { src: 'images/stormdesk-461-history.jpg', version: '4.6.1', caption: /^History \/ StormDesk 4\.6\.1\..*Recorded interface; not live readings\.$/ }
};
const buttons = ['weather', 'radar', 'history'].map(name => ({
  dataset: { preview: name },
  addEventListener(type, handler) { this.click = handler; },
  setAttribute(name, value) { this[name] = value; }
}));
const image = {}, caption = {}, full = {};
runInNewContext(readFileSync(new URL('../assets/carbon-preview.js', import.meta.url), 'utf8'), {
  document: {
    querySelectorAll: () => buttons,
    querySelector: selector => selector === '#product-image' ? image : selector === '#product-full' ? full : caption
  }
});
for (const button of buttons) {
  button.click();
  const preview = expected[button.dataset.preview];
  assert.equal(image.src, preview.src, 'The selected preview uses its versioned screenshot');
  assert.ok(existsSync(new URL('../' + image.src, import.meta.url)));
  assert.ok(image.alt && caption.textContent);
  assert.ok(image.alt.startsWith('StormDesk ' + preview.version + ' '), 'Alt text identifies the captured app version');
  assert.equal(full.href, image.src, 'Full-size link follows the selected preview');
  assert.equal(button['aria-pressed'], 'true');
  assert.equal(buttons.filter(item => item['aria-pressed'] === 'true').length, 1);
  assert.match(caption.textContent, preview.caption, 'The caption identifies the view and illustrative or recorded data');
}
console.log('All three product previews have versioned assets, accurate capture descriptions, and exclusive selection.');
