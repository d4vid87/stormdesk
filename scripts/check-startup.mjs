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
const push = boot.match(/async function pushConfig\([^]*?\n}/)[0];
let scheduled = 0, requests = [], cleared = [];
const context = vm.createContext({
  syncing: false, PUBLIC: false, SRV: '', rev: 1, pushTimer: 7,
  pendingSettings: { stationName: 'Updated' }, mayPush: () => true,
  sharedSettings: (settings = {}) => settings,
  clearTimeout: id => cleared.push(id),
  saveSettings: () => { if (!context.syncing) scheduled++; },
  fetch: async (_, options) => {
    requests.push(JSON.parse(options.body));
    return requests.length === 1
      ? { status: 409, ok: false, json: async () => ({ _rev: 2, settings: { units: 'metric' } }) }
      : { status: 200, ok: true, json: async () => ({ _rev: 3 }) };
  },
});
vm.runInContext(push, context);
assert.equal(await context.pushConfig(), true);
assert.equal(requests.length, 2, 'A conflict retries only once');
assert.equal(scheduled, 0, 'Applying remote settings does not enqueue another save');
assert.ok(cleared.includes(7), 'An immediate save cancels its pending debounce');
assert.deepEqual(requests[1], { _rev: 2, settings: { stationName: 'Updated' } });
assert.equal(context.syncing, false);

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
