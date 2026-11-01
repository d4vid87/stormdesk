import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const seed = `<script>
localStorage.setItem('wd.settings', JSON.stringify({stationSource:'ecowitt',stationName:'Test station',deskRadar:false,eco:'off',motion:'off'}));
localStorage.setItem('wd.setupComplete', '1');
window.searchRequests = [];
window.fetch = (url) => {
  if (String(url).includes('photon.komoot.io')) return new Promise((resolve, reject) => {
    window.searchRequests.push({resolve: features => resolve({ok:true, status:200, headers:new Headers(), json:async () => ({features})}), reject});
  });
  return Promise.resolve(new Response(String(url).includes('sites.json') ? '[]' : '{}',
    {status:String(url).includes('sites.json') ? 200 : 503}));
};
</script>`;
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  try {
    const file = path === '/fixtures/places-check.js' ? join(root, 'scripts', path) : join(root, 'site', path === '/' ? 'index.html' : path);
    let body = await readFile(file);
    if (path === '/') body = Buffer.from(body.toString().replace('</head>', seed + '</head>')
      .replace('</body>', '<script type="module" src="/fixtures/places-check.js"></script></body>'));
    res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.svg') ? 'image/svg+xml' : 'text/html');
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = await mkdtemp(join(tmpdir(), 'stormdesk-places-'));
try {
  await mkdir(join(root, 'shots'), { recursive: true });
  for (const size of ['1280,900', '412,915']) {
    const browser = spawn(process.env.CHROME || 'chromium', ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--user-data-dir=' + join(profile, size), '--window-size=' + size, '--virtual-time-budget=5000', '--dump-dom',
      '--screenshot=' + join(root, 'shots', 'places-' + size.replace(',', 'x') + '.png'),
      `http://127.0.0.1:${server.address().port}/?full=1`]);
    let dom = '', errors = '';
    browser.stdout.on('data', chunk => { dom += chunk; });
    browser.stderr.on('data', chunk => { errors += chunk; });
    const timer = setTimeout(() => browser.kill(), 60000);
    const exit = await new Promise(resolve => browser.on('close', resolve));
    clearTimeout(timer);
    assert.equal(exit, 0, errors.slice(-1500));
    assert.equal(dom.match(/data-places-check="([^"]*)"/)?.[1], 'ok', errors.slice(-1500));
  }
  console.log('Places: search races, retry, plain-text labels, saving, removal, focus and desktop/mobile layout passed.');
} finally {
  server.close();
  await rm(profile, { recursive: true, force: true });
}
