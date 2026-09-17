import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file = resolve('marketing/lite/index.html');
const source = readFileSync(file, 'utf8');
const chrome = process.env.CHROME || 'chromium';

assert.match(source, /Stormdesk Lite/);
assert.match(source, /data-page="today"/);
assert.match(source, /data-page="forecast"/);
assert.match(source, /data-page="radar"/);
assert.match(source, /data-page="more"/);
assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|WebSocket/);

for (const query of ['', '?page=forecast', '?page=radar', '?page=more&theme=dark', '?scenario=stale']) {
  const dom = execFileSync(chrome, [
    '--headless', '--no-sandbox', '--disable-gpu', '--dump-dom', `file://${file}${query}`,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  assert.match(dom, /<nav aria-label="Primary navigation">/);
  assert.match(dom, /Next six hours/);
}

console.log('Stormdesk Lite: 5 rendered states passed');
