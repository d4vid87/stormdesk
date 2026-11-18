import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../site/js/history-daily.js', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const flush = () => new Promise(resolve => setImmediate(resolve));
const reply = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });
function fixture() {
  let now = 1800000000000, next = 0, identity = 'station-A', respond;
  const timers = new Map(), listeners = {}, requests = [];
  const context = vm.createContext({
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } getTimezoneOffset() { return 360; } },
    Intl: { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: 'America/Chicago' }) }) },
    URLSearchParams, AbortController, DOMException, structuredClone,
    stationContext: () => identity,
    setTimeout: (fn, ms) => { timers.set(++next, { fn, at: now + ms }); return next; }, clearTimeout: id => timers.delete(id),
    window: { addEventListener: (type, fn) => { listeners[type] = fn; } },
    fetch: (url, options) => { requests.push({ url, options }); return respond(url, options); },
  });
  vm.runInContext(source, context);
  return { daily: context.dailyHistory, query: context.historyTimezoneQuery, requests, timers,
    response: fn => { respond = fn; },
    async advance(ms) { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } await flush(); },
    switch() { identity = 'station-B'; listeners['wd:settings'](); },
    changed() { listeners['wd:archive-change'](); },
  };
}

{
  const f = fixture(); let finish;
  f.response(() => new Promise(resolve => { finish = resolve; }));
  const a = f.daily(), b = f.daily();
  assert.equal(f.requests.length, 1, 'Almanac, season and report share one in-flight request');
  const params = new URLSearchParams(f.query());
  assert.equal(params.get('tz'), '-360'); assert.equal(params.get('tz_name'), 'America/Chicago');
  assert.equal(f.requests[0].options.cache, 'no-store');
  finish(reply([{ day: '2026-06-01', rain: 0 }]));
  const [one, two] = await Promise.all([a, b]);
  one[0].rain = 5; assert.equal(two[0].rain, 0, 'consumer mutations cannot leak into another panel');
  assert.equal(f.timers.size, 0);
  f.response(() => reply([])); await f.daily();
  assert.equal(f.requests.length, 2, 'completed responses are not kept as a stale persistent cache');
}
{
  const f = fixture();
  f.response(() => f.requests.length === 1 ? reply({ error: 'Daily build busy' }, 503, { 'Retry-After': '1' }) : reply([{ day: '2026-11-18' }]));
  const result = f.daily(); await flush();
  await f.advance(999); assert.equal(f.requests.length, 1, 'server retry interval is honored');
  await f.advance(1); assert.equal(f.requests.length, 2); assert.equal((await result)[0].day, '2026-11-18');
  assert.equal(f.timers.size, 0);
}
{
  const f = fixture();
  f.response(() => reply({ error: 'Still building' }, 503, { 'Retry-After': '1' }));
  const failure = assert.rejects(f.daily(), /Still building|timed out/); await flush();
  for (let i = 0; i < 15; i++) await f.advance(1000);
  await failure; assert.ok(f.requests.length <= 15, 'busy retry is bounded to fifteen seconds');
  assert.equal(f.timers.size, 0);
}
{
  const f = fixture(); let finish;
  f.response(() => new Promise(resolve => { finish = resolve; }));
  const controller = new AbortController();
  const cancelled = assert.rejects(f.daily({ signal: controller.signal }), { name: 'AbortError' });
  const remaining = f.daily(); controller.abort(); await cancelled;
  assert.equal(f.requests[0].options.signal.aborted, false, 'one closed reader cannot cancel another panel');
  finish(reply([])); await remaining;
}
for (const action of ['cancel', 'station', 'archive', 'timeout']) {
  const f = fixture(), controller = new AbortController();
  f.response((url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })));
  const result = assert.rejects(f.daily({ signal: controller.signal }), { name: action === 'timeout' ? 'TimeoutError' : 'AbortError' });
  if (action === 'cancel') controller.abort();
  else if (action === 'station') f.switch();
  else if (action === 'archive') f.changed();
  else await f.advance(15000);
  await result; await flush();
  assert.equal(f.requests[0].options.signal.aborted, true, `${action} aborts the actual network request`);
  assert.equal(f.timers.size, 0, `${action} cleans up all timers`);
}
for (const status of [401, 403, 404, 503]) {
  const f = fixture(); f.response(() => reply({ error: `Original ${status} message` }, status));
  await assert.rejects(f.daily(), new RegExp(`Original ${status}`));
  assert.equal(f.requests.length, 1, 'errors without explicit busy backoff do not retry or turn into empty records');
}
console.log('Daily history: IANA timezone, shared requests, isolated data, bounded busy retry, cancellation, source changes, timeout and original error propagation passed.');
