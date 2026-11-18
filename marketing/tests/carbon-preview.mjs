import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const expected = {
  weather: { src: 'images/stormdesk-4121-weather.jpg', caption: /^StormDesk 4\.12\.1 demo weather, captured November 18, 2026; illustrative, not current weather\.$/ },
  radar: { src: 'images/stormdesk-4121-radar.jpg', caption: /^Radar \/ StormDesk 4\.12\.1\..*KFWS near Fort Worth, captured November 18, 2026 around 2:58 PM CST\. Separate from the demo readings; recorded, not live radar\.$/ },
  history: { src: 'images/stormdesk-4121-history.jpg', caption: /^History \/ StormDesk 4\.12\.1\..*captured November 18, 2026; illustrative, not live readings\.$/ },
  customize: { src: 'images/stormdesk-4121-layout-picker.jpg', caption: /^Customize \/ StormDesk 4\.12\.1\..*captured November 18, 2026 with demo weather\.$/ },
  arrange: { src: 'images/stormdesk-4121-layout-editor.jpg', caption: /^Arrange \/ StormDesk 4\.12\.1\..*captured November 18, 2026 with demo weather\.$/ }
};
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const previewNames = [...html.matchAll(/data-preview="([^"]+)"/g)].map(match => match[1]);
assert.deepEqual(previewNames, Object.keys(expected), 'Every visible preview control has a release screenshot');
const buttons = previewNames.map(name => ({
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
  assert.ok(image.alt.startsWith('StormDesk 4.12.1 '), 'Alt text identifies the captured app version');
  assert.equal(full.href, image.src, 'Full-size link follows the selected preview');
  assert.equal(button['aria-pressed'], 'true');
  assert.equal(buttons.filter(item => item['aria-pressed'] === 'true').length, 1);
  assert.match(caption.textContent, preview.caption, 'The caption identifies the view and illustrative or recorded data');
}
console.log('All five product previews have versioned assets, accurate capture descriptions, and exclusive selection.');
