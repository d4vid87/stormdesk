import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file = resolve('marketing/lite/index.html');
const source = readFileSync(file, 'utf8');
const production = readFileSync(resolve('site/lite/index.html'), 'utf8');
const productionJs = readFileSync(resolve('site/lite/lite.js'), 'utf8');
const chrome = process.env.CHROME || 'chromium';

assert.match(source, /Stormdesk Lite/);
assert.match(source, /data-page="today"/);
assert.match(source, /data-page="forecast"/);
assert.match(source, /data-page="radar"/);
assert.match(source, /data-page="more"/);
assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|WebSocket/);
assert.match(production, /src="lite\.js"/);
assert.match(productionJs, /api\.betterForecast\(\)/);
assert.match(productionJs, /hostJSON\('\/api\/v1'\)/);
assert.match(productionJs, /\/pair\/claim/);
assert.match(productionJs, /hookecho\.pages\.dev/);
assert.match(productionJs, /!site\.id\.startsWith\('T'\)/);
assert.match(productionJs, /Radar snapshot unavailable/);
assert.doesNotMatch(productionJs, /Sample forecast|DEMO-TOKEN/);

for (const query of ['', '?page=forecast', '?page=radar', '?page=more&theme=dark', '?scenario=stale']) {
  const dom = execFileSync(chrome, [
    '--headless', '--no-sandbox', '--disable-gpu', '--dump-dom', `file://${file}${query}`,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  assert.match(dom, /<nav aria-label="Primary navigation">/);
  assert.match(dom, /Next six hours/);
}

console.log('Stormdesk Lite: production wiring and 5 design states passed');
