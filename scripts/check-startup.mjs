import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const site = new URL('../site/', import.meta.url);
const html = readFileSync(new URL('index.html', site), 'utf8');
const entry = new URL(html.match(/<script type="module" src="([^"]*boot\.js[^"]*)"/)[1], site);
const loaded = new Map();
function visit(url) {
  const previous = loaded.get(url.pathname);
  assert.ok(!previous || previous === url.href, `Module loaded under two URLs: ${url.pathname}`);
  if (previous) return;
  loaded.set(url.pathname, url.href);
  const source = readFileSync(url, 'utf8');
  for (const match of source.matchAll(/^import\s+(?:[^\n]*?\sfrom\s+)?['"]([^'"]+)['"]/gm)) {
    const dependency = new URL(match[1], url);
    assert.notEqual(dependency.pathname, entry.pathname, 'Feature modules must not import the startup module');
    visit(dependency);
  }
}
visit(entry);
for (const match of html.matchAll(/<link rel="modulepreload" href="([^"]+)"/g)) {
  const preload = new URL(match[1], site), actual = loaded.get(preload.pathname);
  if (actual) assert.equal(preload.href, actual, 'Preloads use the same module URL as imports');
}

const app = readFileSync(new URL('js/app.js', site), 'utf8');
const distance = app.match(/export function milesBetween\([^]*?\n}/)[0].replace('export ', '');
const geo = vm.createContext({}); vm.runInContext(distance, geo);
assert.equal(Math.round(geo.milesBetween(35.33, -97.28, 32.57, -97.30)), 191);
assert.equal(geo.milesBetween(40, -90, 40, -90), 0);

const boot = readFileSync(new URL('js/boot.js', site), 'utf8');
const sent = [], fetchWindow = {};
// Node has no document base URL; otherwise use its real Fetch implementation.
class BrowserRequest extends Request {
  constructor(input, init) { super(typeof input === 'string' ? new URL(input, 'https://app.test/') : input, init); }
}
vm.runInNewContext(boot.match(/window.fetch = \(input, init = \{\}\) => \{[^]*?\n};/)[0], {
  window: fetchWindow, URL, Request: BrowserRequest, Headers,
  location: { href: 'https://app.test/', origin: 'https://app.test' },
  EDITOR_TOKEN: 'test-editor', SRV: '',
  nativeFetch: (input, init) => sent.push({ input, init }),
});
fetchWindow.fetch(new URL('https://external.test/weather'));
assert.equal(sent.at(-1).input.headers.get('Authorization'), null, 'URL objects must not leak the editor token to another origin');
fetchWindow.fetch(new Request('https://external.test/weather'));
assert.equal(sent.at(-1).input.headers.get('Authorization'), null, 'Requests from another constructor must not receive editor credentials');
fetchWindow.fetch(new Request('https://app.test/config', { headers: { 'X-Existing': 'kept' } }));
assert.equal(sent.at(-1).input.headers.get('Authorization'), 'Bearer test-editor');
assert.equal(sent.at(-1).input.headers.get('X-Existing'), 'kept', 'Request headers survive authentication');
fetchWindow.fetch('/config', { headers: new Headers({ 'Content-Type': 'application/json' }) });
assert.equal(sent.at(-1).input.headers.get('Content-Type'), 'application/json', 'Headers objects survive authentication');
fetchWindow.fetch(new URL('https://app.test/config'), { headers: [['X-Tuple', 'kept']] });
assert.equal(sent.at(-1).input.headers.get('X-Tuple'), 'kept');
fetchWindow.fetch(new Request('https://app.test/config', { method: 'PUT', body: '{"test":true}' }));
assert.equal(await sent.at(-1).input.text(), '{"test":true}', 'Authentication preserves request bodies');

await import('./check-config-sync.mjs');

const motion = readFileSync(new URL('js/motion.js', site), 'utf8');
let preference = 'auto', eco = false;
const motionContext = vm.createContext({
  safeMode: () => false, URLSearchParams, location: { search: '' },
  REDUCED: { matches: false }, window: { __WD_SOFTWARE_RENDERER: true },
  settings: () => ({ motion: preference }), ecoOn: () => eco,
});
vm.runInContext(motion.match(/export function motionLevel\([^]*?\n}/)[0].replace('export ', ''), motionContext);
assert.equal(motionContext.motionLevel(), 'lite', 'Auto motion respects the native software renderer');
preference = 'full'; assert.equal(motionContext.motionLevel(), 'full', 'Explicit full motion is preserved');
preference = 'off'; assert.equal(motionContext.motionLevel(), 'off');
preference = 'auto'; motionContext.window.__WD_SOFTWARE_RENDERER = false;
assert.equal(motionContext.motionLevel(), 'full', 'Capable browsers retain full motion');
eco = true; assert.equal(motionContext.motionLevel(), 'lite');
motionContext.REDUCED.matches = true; assert.equal(motionContext.motionLevel(), 'off');
console.log(`Startup: ${loaded.size} unique modules, distance, conflict-save and renderer-aware motion checks passed.`);
