import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { historyContext, recentHistory, rememberHistory } from '../site/lite/history-cache.js';

const memory = new Map();
globalThis.localStorage = { getItem: (key) => memory.get(key) || null, setItem: (key, value) => memory.set(key, value) };
const context = historyContext({ stationId: '123', stationSource: '', activePlace: null }, { lat: 35, lon: -97 });
rememberHistory(context, { time: Math.floor(Date.now() / 900) * 900, tempC: 21, windMs: 2, rainMm: 0, source: 'station' });
rememberHistory(context, { time: Math.floor(Date.now() / 900) * 900 + 60, tempC: 22, windMs: 2, rainMm: 0, source: 'station' });
assert.equal(recentHistory(context).length, 1, 'one browser write per 15-minute bucket');
assert.equal(recentHistory('different station').length, 0, 'history stays with its station or place');

const seedContext = historyContext({ stationId: '', stationSource: '', activePlace: null }, { lat: 35, lon: -97 });
const seed = `<script>
localStorage.setItem('wd.settings', JSON.stringify({ lat:35, lon:-97, stationName:'Test', units:'imperial' }));
localStorage.setItem('wd.liteHistory.v1', JSON.stringify({ context:${JSON.stringify(seedContext)}, rows:[
  { time:Math.floor(Date.now()/1000)-1800, tempC:21, windMs:2, rainMm:0, source:'station' }
] }));
window.fetch = async (url) => new Response(String(url).includes('sites.json') ? '[]' : '{}',
  { status:String(url).includes('sites.json') ? 200 : 503, headers:{ 'Content-Type':'application/json' } });
if (location.search.includes('soak')) {
  setTimeout(() => { window.gc?.(); document.body.dataset.heapStart = performance.memory?.usedJSHeapSize || 0; }, 600000);
  setTimeout(() => { window.gc?.(); document.body.dataset.heapEnd = performance.memory?.usedJSHeapSize || 0; }, 3600000);
}
</script>`;
const root = join(import.meta.dirname, '..', 'site');
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  try {
    const file = join(root, path === '/' ? 'index.html' : path === '/lite/' ? 'lite/index.html' : path.slice(1));
    let body = await readFile(file);
    if (path === '/lite/') body = Buffer.from(body.toString().replace('</head>', `${seed}</head>`));
    res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.json') ? 'application/json' : 'text/html');
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  const chrome = process.env.CHROME || 'chromium';
  async function capture(path, flags = []) {
    const browser = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--enable-precise-memory-info', '--js-flags=--expose-gc', '--dump-dom', ...flags,
      `http://127.0.0.1:${server.address().port}${path}`]);
    let dom = '', errors = '';
    browser.stdout.on('data', (chunk) => { dom += chunk; });
    browser.stderr.on('data', (chunk) => { errors += chunk; });
    const timer = setTimeout(() => browser.kill(), 60000);
    const exit = await new Promise((resolve) => browser.on('close', resolve));
    clearTimeout(timer);
    assert.equal(exit, 0, errors.slice(-1000));
    return dom;
  }
  const dom = await capture('/lite/?page=history', ['--virtual-time-budget=5000']);
  assert.match(dom, /hourly samples/, 'History rendered after dynamic import');
  assert.match(dom, /70°F/, 'Saved sample is visible in the chosen unit system');
  for (const agent of ['Mozilla/5.0 (Linux; Tizen 9.0) Family Hub', 'Mozilla/5.0 (X11; CrOS x86_64) Chrome/130']) {
    const routed = await capture('/?page=history', ['--virtual-time-budget=5000', `--user-agent=${agent}`]);
    assert.match(routed, /<title>Stormdesk Lite<\/title>/, 'Constrained browser opens Lite before full boot');
    assert.match(routed, /hourly samples/, 'Routed browser retains History');
  }
  const soaked = await capture('/lite/?page=history&soak=1', ['--virtual-time-budget=3610000']);
  const start = Number(soaked.match(/data-heap-start="(\d+)"/)?.[1]);
  const end = Number(soaked.match(/data-heap-end="(\d+)"/)?.[1]);
  assert.ok(start > 0 && end > 0, 'Long-session heap samples were collected');
  assert.ok(end < start * 1.5 + 5_000_000, `Lite heap grew from ${start} to ${end}`);
  console.log('Lite history: cache, device routes, browser rendering, and virtual-hour memory passed');
} finally { server.close(); }
