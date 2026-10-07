import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { safeMode } from '../site/js/compat.js';
assert.equal(safeMode('Mozilla/5.0 (Linux; Tizen 6.0; SAMSUNG Family Hub 9.0)', ''), true);
assert.equal(safeMode('Mozilla/5.0 SMART-TV', '?motion=full'), true);
assert.equal(safeMode('Mozilla/5.0 Android SamsungBrowser/25.0', ''), false);
assert.equal(safeMode('Mozilla/5.0 Chrome/130', '?safe=1'), true);
assert.equal(safeMode('Mozilla/5.0 Chrome/130', '?safe=0'), false);
assert.equal(safeMode('Mozilla/5.0 (X11; CrOS x86_64) Chrome/130', ''), true);

const html = readFileSync('site/index.html', 'utf8');
const bootstrap = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(bootstrap, 'compatibility bootstrap loads before the dashboard modules');
function start(userAgent, search = '', pending = null, capacity = {}) {
  const memory = new Map(pending ? [['wd.boot.pending', JSON.stringify(pending)]] : []);
  let destination = '';
  const location = { pathname: '/', search, href: `https://app.mystormdesk.com/${search}`,
    replace: (url) => { destination = String(url); } };
  runInNewContext(bootstrap, { URL, URLSearchParams, Date, JSON, location, navigator: { userAgent, ...capacity },
    localStorage: { getItem: (key) => memory.get(key) || null, setItem: (key, value) => memory.set(key, value) }, window: {} });
  return { destination, memory };
}
assert.match(start('Mozilla/5.0 (Linux; Tizen) Family Hub').destination, /\/lite\//);
assert.match(start('Mozilla/5.0 (X11; CrOS x86_64)').destination, /\/lite\//);
assert.equal(start('Mozilla/5.0 Android SamsungBrowser/25.0').destination, '');
assert.match(start('Mozilla/5.0 Chrome/130', '', { started: Date.now() }).destination, /\/lite\//);
assert.match(start('Mozilla/5.0 Chrome/130', '', null, { deviceMemory: 2, hardwareConcurrency: 4 }).destination, /\/lite\//);
assert.equal(start('Mozilla/5.0 (Linux; Tizen)', '?full=1').destination, '');
console.log('Browser compatibility checks passed');
