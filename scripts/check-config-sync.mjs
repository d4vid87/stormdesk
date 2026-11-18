import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const boot = readFileSync(new URL('../site/js/boot.js', import.meta.url), 'utf8');
const code = boot.slice(boot.indexOf('let rev = null;'), boot.indexOf('// Where a console is told')).replaceAll('export ', '');
function harness() {
  const listeners = {}, requests = [], timers = new Map();
  let prefs = { stationId: 'A', units: 'imperial' }, timer = 0;
  const context = vm.createContext({
    PUBLIC: false, SRV: '', syncing: false, expires: () => undefined,
    window: { addEventListener: (name, fn) => { listeners[name] = fn; }, dispatchEvent: e => listeners[e.type]?.(e) },
    CustomEvent: class { constructor(type, { detail }) { this.type = type; this.detail = detail; } },
    LOCAL_SETTING_KEYS: new Set(['palette']), configured: () => true,
    localStorage: { getItem: () => 'migrated' },
    sharedSettings: (value = prefs) => Object.fromEntries(Object.entries(value).filter(([k]) => k !== 'palette')),
    settings: () => prefs,
    saveSettings: patch => { prefs = { ...prefs, ...patch }; listeners['wd:settings']({ detail: patch }); },
    setTimeout: fn => { timers.set(++timer, fn); return timer; }, clearTimeout: id => timers.delete(id),
    fetch: (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })),
  });
  vm.runInContext(code, context);
  const respond = async (index, rev, settings, status = 200) => {
    requests[index].resolve({ ok: status === 200, status, json: async () => ({ _rev: rev, settings }) });
    for (let i = 0; i < 8; i++) await Promise.resolve();
  };
  return { context, requests, timers, respond, prefs: () => prefs, revision: () => vm.runInContext('rev', context) };
}
const a = harness();
const pull = a.context.pullConfig();
a.context.saveSettings({ stationId: 'B', units: 'metric', palette: 'eink' });
await a.respond(0, 1, { stationId: 'A', units: 'imperial' }); await pull;
assert.equal(a.prefs().stationId, 'B', 'a delayed GET preserves new local edits');
assert.equal(a.prefs().units, 'metric');
assert.equal(a.prefs().palette, 'eink');
const first = a.context.pushConfig();
a.context.saveSettings({ stationId: 'C' });
const second = a.context.pushConfig();
assert.equal(a.requests.length, 2, 'overlapping saves share one PUT');
assert.deepEqual(JSON.parse(a.requests[1].options.body).settings, { stationId: 'B', units: 'metric' });
await a.respond(1, 2);
assert.equal(a.requests.length, 3, 'edits made during PUT are drained next');
assert.deepEqual(JSON.parse(a.requests[2].options.body), { _rev: 2, settings: { stationId: 'C' } });
await a.respond(2, 3); assert.equal(await first, true); assert.equal(await second, true);
assert.equal(a.timers.size, 0, 'drained edits leave no duplicate-save timer');
const old = a.context.pullConfig(), newer = a.context.pullConfig();
await a.respond(4, 5, { units: 'metric' }); await newer;
await a.respond(3, 4, { units: 'imperial' }); await old;
assert.equal(a.revision(), 5); assert.equal(a.prefs().units, 'metric');
assert.equal(a.context.shouldPull(4), false, 'older revision events do not fetch');
const late = a.context.pullConfig();
a.context.saveSettings({ units: 'imperial' });
const write = a.context.pushConfig();
await a.respond(6, 6); await write;
await a.respond(5, 5, { units: 'metric' }); await late;
assert.equal(a.prefs().units, 'imperial', 'GET started before successful PUT cannot revert it');
assert.equal(a.revision(), 6);

const b = harness();
b.context.saveSettings({ stationId: 'B' });
const conflict = b.context.pushConfig();
b.context.saveSettings({ stationId: 'C' });
await b.respond(0, 2, { stationId: 'A', units: 'metric' }, 409);
assert.equal(b.prefs().stationId, 'C', 'conflict preserves the newest edit, including UI state');
assert.equal(b.prefs().units, 'metric', 'unmodified server keys are merged');
assert.deepEqual(JSON.parse(b.requests[1].options.body), { _rev: 2, settings: { stationId: 'C' } });
await b.respond(1, 3); assert.equal(await conflict, true);
assert.equal(b.requests.length, 2, 'remote apply does not echo another PUT');
b.context.saveSettings({ stationId: 'D' });
const failed = b.context.pushConfig();
await b.respond(2, 4, {}, 409); await b.respond(3, 5, {}, 409);
assert.equal(await failed, false, 'repeated conflict is bounded');
const retry = b.context.pushConfig();
assert.equal(JSON.parse(b.requests[4].options.body).settings.stationId, 'D', 'failed edits survive for retry');
await b.respond(4, 6); assert.equal(await retry, true);
console.log('Config sync: delayed/reordered GETs, serialized PUTs, local-only settings, conflict merge, bounded retries, and retained edits passed.');

const c = harness();
const slowNewerRevision = c.context.pullConfig(), fastOlderRevision = c.context.pullConfig();
await c.respond(1, 7, { units: 'imperial' }); await fastOlderRevision;
await c.respond(0, 8, { units: 'metric' }); await slowNewerRevision;
assert.equal(c.revision(), 8, 'a newer host revision wins even when its GET started first');
assert.equal(c.prefs().units, 'metric');

const d = harness();
d.context.saveSettings({ units: 'metric' });
const interrupted = d.context.pushConfig();
d.requests[0].reject(new Error('Simulated request timeout'));
assert.equal(await interrupted, false, 'a failed or timed-out request does not acknowledge a save');
d.context.saveSettings({ stationId: 'B' });
const recovered = d.context.pushConfig();
assert.deepEqual(JSON.parse(d.requests[1].options.body).settings, { units: 'metric', stationId: 'B' });
await d.respond(1, 1); assert.equal(await recovered, true);
assert.equal(d.timers.size, 0);
