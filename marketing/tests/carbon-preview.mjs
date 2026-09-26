import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const buttons = ['weather', 'radar', 'history'].map(name => ({
  dataset: { preview: name },
  addEventListener(type, handler) { this.click = handler; },
  setAttribute(name, value) { this[name] = value; }
}));
const image = {}, caption = {};
runInNewContext(readFileSync(new URL('../assets/carbon-preview.js', import.meta.url), 'utf8'), {
  document: {
    querySelectorAll: () => buttons,
    querySelector: selector => selector === '#product-image' ? image : caption
  }
});
for (const button of buttons) {
  button.click();
  assert.ok(existsSync(new URL('../' + image.src, import.meta.url)));
  assert.ok(image.alt && caption.textContent);
  assert.equal(button['aria-pressed'], 'true');
  assert.equal(buttons.filter(item => item['aria-pressed'] === 'true').length, 1);
  assert.match(caption.textContent.toLowerCase(), new RegExp('^' + button.dataset.preview));
}
console.log('All three product previews have real assets, descriptions, and exclusive selection.');
