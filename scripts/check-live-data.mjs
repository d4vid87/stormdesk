// Actual modules with isolated clocks, transports and settings: no live account or disk writes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { forecastTime } from '../site/js/weather-context.js';

const code = file => readFileSync(new URL('../site/js/' + file, import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const tuple = (at, temperature = 20, strikes = 0) => [at, 0, 2, 4, 90, 3, 1013, temperature, 50, 0, 2, 50, 0, 0, null, strikes, 2.4, 1, null];

function fixture() {
  let cfg = { stationSource: '', token: 'test-only', stationId: 'A', deviceId: '111', units: 'metric', windUnit: 'ms',
    lat: 32, lon: -97, rules: [], places: [], nearbyStations: [], nearbyMetar: [], nearbyExclude: [] };
  let now = Date.UTC(2026, 10, 18, 18, 30), timerId = 0;
  const listeners = {}, nodes = new Map(), timers = new Map(), sockets = [], streams = [], notices = [], events = [], jobs = new Map();
  const element = id => {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', innerHTML: '', className: '', dataset: {}, style: {},
      querySelectorAll: () => [], setAttribute() {}, classList: { add() {}, remove() {} } });
    return nodes.get(id);
  };
  class Event { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }
  const window = {
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    dispatchEvent(event) { events.push(event); for (const fn of listeners[event.type] || []) fn(event); },
  };
  class Socket {
    constructor(url) { this.url = url; this.sent = []; sockets.push(this); }
    send(value) { this.sent.push(JSON.parse(value)); }
    close() { this.closed = true; this.onclose?.(); }
  }
  class Stream {
    constructor() { this.handlers = {}; streams.push(this); }
    addEventListener(type, fn) { this.handlers[type] = fn; }
    close() { this.closed = true; }
  }
  window.EventSource = Stream;
  const document = { hidden: false, getElementById: element, querySelectorAll: () => [], addEventListener: window.addEventListener };
  const common = {
    console, URLSearchParams, URL, window, document, CustomEvent: Event, WebSocket: Socket, EventSource: Stream,
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } },
    location: { search: '' }, settings: () => cfg, coords: () => ({ lat: cfg.lat, lon: cfg.lon }),
    saveSettings: patch => set(patch), load: (_, fallback) => fallback, store() {},
    notify: notice => notices.push(notice), every: (key, seconds, fn) => jobs.set(key, fn), configured: () => true, hasSource: () => true,
    num: value => value == null ? '--' : String(value), deg2compass: () => 'E', timeStr: () => '', notifHistory: () => [], milesBetween: () => 5,
    U: { temp: () => cfg.units === 'metric' ? '°C' : '°F', wind: () => 'm/s', precip: () => 'mm', press: () => 'mb', dist: () => 'km' },
    windUnit: () => cfg.windUnit || 'ms', msToWind: value => value, WIND_UNITS: { ms: { fromMs: 1, om: 'ms', tempest: 'mps' } },
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
    forecastTime, expires: () => undefined,
  };
  const load = (file, additions = {}) => {
    const context = vm.createContext({ ...common, ...additions });
    vm.runInContext(code(file), context, { filename: file });
    return context;
  };
  const apiContext = load('api.js');
  const api = vm.runInContext('({stationContext,acceptObservation,publishObservation,overlayStation,siToDisplay,OBS})', apiContext);
  function set(patch) { cfg = { ...cfg, ...patch }; window.dispatchEvent(new Event('wd:settings', { detail: patch })); }
  return { api, apiContext, load: (file, extra) => load(file, { api, OBS: api.OBS, stationContext: api.stationContext,
    publishObservation: api.publishObservation, ...extra }), set, settings: () => cfg, nodes, element, events, notices, timers, sockets, streams, jobs, document,
    emit: (type, detail) => window.dispatchEvent(new Event(type, { detail })),
    get now() { return now / 1000; }, advance: seconds => { now += seconds * 1000; } };
}

// Cloud feed follows actual station identity, including a host config pull and a saved profile.
{
  const f = fixture(), sig = f.load('signals.js');
  sig.connectWs(); const first = f.sockets[0]; first.onopen();
  assert.equal(first.sent[0].device_id, 111);
  f.set({ palette: 'violet', motion: 'off' }); assert.equal(f.sockets.length, 1, 'presentation changes do not reconnect');
  const oldMessage = first.onmessage;
  f.set({ stationSource: 'wll' });
  assert.equal(first.closed, true, 'local source closes cloud even if old token remains saved');
  oldMessage({ data: JSON.stringify({ type: 'obs_st', obs: [tuple(f.now)] }) });
  assert.equal(f.events.filter(e => e.type === 'wd:ws-obs').length, 0, 'queued old-source callbacks cannot publish');
  f.set({ stationSource: '', deviceId: '222', activeStationProfile: 'cabin' });
  const second = f.sockets.at(-1); second.onopen(); assert.equal(second.sent[0].device_id, 222);
  second.onclose(); const queuedRetry = [...f.timers.values()].at(-1);
  sig.disconnectWs(); const count = f.sockets.length;
  assert.equal(f.timers.size, 0, 'disconnect cancels reconnect timer');
  queuedRetry(); assert.equal(f.sockets.length, count, 'already queued callback cannot revive disconnected socket');
  sig.connectWs(); const third = f.sockets.at(-1); third.onopen();
  queuedRetry(); assert.equal(f.sockets.length, count + 1, 'prior retry cannot replace a newly opened socket');
  f.set({ token: '', deviceId: '' }); assert.equal(third.closed, true);
  f.set({ stationSource: 'tempest', token: 'test-only', deviceId: '333' });
  f.sockets.at(-1).onopen(); assert.equal(f.sockets.at(-1).sent[0].device_id, 333, 'explicit Tempest source remains supported');
}

// Provider and saved names, ids, and network errors remain text in both nearby tables.
{
  const f = fixture(), attack = '\"><img src=x onerror="attack()"> & <svg/onload=attack()>';
  f.set({ nearbyStations: [attack], nearbyMetar: [{ id: attack, name: attack }] });
  f.api.stationObs = async () => ({ station_name: attack, obs: [{ timestamp: f.now, air_temperature: 20 }] });
  f.api.metarObs = async () => { throw Error(attack); };
  await f.load('signals.js').refreshSignals();
  for (const id of ['signals-table', 'nearby-table']) {
    const html = f.element(id).innerHTML;
    assert.ok(!html.includes('<img') && !html.includes('<svg'), 'untrusted labels cannot create HTML nodes');
    assert.match(html, /&lt;img/); assert.match(html, /&quot;/); assert.match(html, /&amp;/);
    assert.match(html, /data-id="&quot;&gt;/, 'quoted ids remain one attribute');
    assert.match(html, /title="&quot;&gt;/, 'error text remains one attribute');
  }
}

// One current-reading gate covers REST, WS and local data, without filtering historical data.
{
  const f = fixture(), fresh = tuple(f.now, 25, 2), context = f.api.stationContext();
  assert.equal(context, f.api.stationContext({ ...f.settings(), activeStationProfile: '', ecowittAppKey: '', lacrossePass: '' }), 'sparse host settings and local blank defaults have the same identity');
  assert.equal(f.api.publishObservation(fresh), true);
  assert.equal(f.api.publishObservation([...fresh]), false, 'exact WS/UDP duplicates publish once');
  assert.equal(f.api.publishObservation(tuple(f.now - 60, 10)), false, 'delayed report cannot overwrite current weather');
  const enriched = [...fresh]; enriched[18] = 0;
  assert.equal(f.api.publishObservation(enriched), true, 'same timestamp may add a known zero day total');
  assert.equal(f.api.publishObservation(fresh), false, 'alternating transports do not keep replaying original report');
  assert.equal(f.api.acceptObservation({ timestamp: f.now - 60, air_temperature: 10 }), false, 'REST shares the live clock');
  const rest = { timestamp: f.now, dew_point: 12 };
  assert.equal(f.api.acceptObservation(rest), true, 'REST can enrich a tuple timestamp');
  assert.equal(f.api.acceptObservation({ ...rest, _savedAt: 123 }), false, 'metadata changes are not fresh readings');
  for (const at of [null, NaN, 0, f.now - 601, f.now + 301]) assert.equal(f.api.publishObservation(tuple(at)), false);
  f.document.hidden = true; f.advance(60);
  assert.equal(f.api.publishObservation(tuple(f.now)), true, 'background collection continues');
  const c = {}; f.api.overlayStation(c, tuple(f.now, 25)); f.api.overlayStation(c, tuple(f.now - 60, 10));
  assert.equal(c.air_temperature, 25, 'overlay is defensive against direct older tuples');
  assert.equal(f.api.siToDisplay([tuple(f.now - 86400)])[0][0], f.now - 86400, 'history conversion remains unrestricted');
  f.set({ stationId: 'B', activeStationProfile: 'b' });
  assert.equal(f.api.publishObservation(tuple(f.now), context), false, 'in-flight old-source results are rejected');
  assert.equal(f.api.publishObservation(tuple(f.now - 60)), true, 'new station owns an independent current clock');
}

// The alert ring and holds follow station + units, never theme; report time governs holds.
{
  const f = fixture(); f.load('rules.js');
  f.set({ rules: [{ id: 'fall', metric: 'temp1h', op: '<', value: -10, durMin: 0 }] });
  f.emit('wd:ws-obs', tuple(f.now, 30)); f.advance(3600);
  f.set({ stationId: 'B' }); f.emit('wd:ws-obs', tuple(f.now, 10));
  assert.equal(f.notices.length, 0, 'first reading at B cannot use A history');
  f.set({ units: 'imperial' }); f.advance(60); f.emit('wd:ws-obs', tuple(f.now, 10));
  assert.equal(f.notices.length, 0, 'unit changes clear incompatible history');

  f.set({ stationId: 'C', units: 'metric', rules: [{ id: 'warm', metric: 'temp', op: '>', value: 15, durMin: 1 }] });
  const start = f.now;
  f.emit('wd:ws-obs', tuple(start, 20)); f.advance(60);
  f.emit('wd:ws-obs', tuple(start, 20));
  assert.equal(f.notices.length, 0, 'replaying the same report cannot complete an alert hold');
  f.set({ palette: 'violet' }); f.emit('wd:ws-obs', tuple(f.now, 20));
  assert.equal(f.notices.length, 1, 'cosmetic settings preserve a valid hold');
  f.set({ stationId: 'D' }); f.advance(60); f.emit('wd:ws-obs', tuple(f.now, 20));
  assert.equal(f.notices.length, 1, 'old-station hold does not carry over');
  f.advance(60); f.emit('wd:ws-obs', tuple(f.now, 20));
  assert.equal(f.notices.length, 2, 'new station can fire the same copied rule id');

  f.set({ stationId: 'E', rules: [{ id: 'strikes', metric: 'strikes3h', op: '>', value: 3, durMin: 0 }] });
  const at = f.now; f.emit('wd:ws-obs', tuple(at, 20, 2));
  f.advance(60); f.emit('wd:ws-obs', tuple(f.now, 20, 1));
  f.emit('wd:ws-obs', tuple(at, 20, 2));
  f.emit('wd:obs', { timestamp: f.now, dew_point: 12 });
  assert.equal(f.notices.length, 2, 'out-of-order and same-timestamp enrichments cannot double count strikes');
  f.advance(60); f.emit('wd:ws-obs', tuple(f.now, 20, 1));
  assert.equal(f.notices.length, 3, 'genuine later strikes still fire');
}

// Both local paths use the shared gate, and late events from a closed stream stay isolated.
{
  const f = fixture();
  f.api.stationObs = async () => ({});
  const sig = f.load('signals.js');
  f.load('udp.js', { renderRapid: sig.renderRapid, onStrike: sig.onStrike }).initUdp();
  f.emit('wd:host-config', { ...f.settings(), _rev: 1 });
  const first = f.streams.at(-1), send = obs => first.handlers.udp({ data: JSON.stringify({ type: 'obs_st', _at: f.now, obs: [obs] }) });
  send(tuple(f.now)); send(tuple(f.now)); send(tuple(f.now - 60));
  assert.equal(f.events.filter(e => e.type === 'wd:ws-obs').length, 1);
  f.set({ stationId: 'B' }); assert.equal(first.closed, true);
  send(tuple(f.now + 60)); assert.equal(f.events.filter(e => e.type === 'wd:ws-obs').length, 1);
  let second = f.streams.at(-1);
  const next = extra => second.handlers.udp({ data: JSON.stringify({ type: 'obs_st', _at: f.now, obs: [tuple(f.now)], ...extra }) });
  next(); assert.equal(f.events.filter(e => e.type === 'wd:ws-obs').length, 1, 'new stream cannot label old-host data as the optimistic selection');
  const queued = second.handlers.udp;
  f.emit('wd:host-config', { ...f.settings(), _rev: 2 });
  queued({ data: JSON.stringify({ type: 'obs_st', _at: f.now, obs: [tuple(f.now, 99)] }) });
  assert.equal(f.events.filter(e => e.type === 'wd:ws-obs').length, 1, 'pre-ack stream packet queued until after acknowledgement remains rejected');
  second = f.streams.at(-1);
  second.handlers.config({ data: JSON.stringify({ rev: 2 }) });
  next(); assert.equal(f.events.filter(e => e.type === 'wd:ws-obs').length, 2, 'own acknowledged config event retains live feed');
  f.advance(60); second.handlers.config({ data: JSON.stringify({ rev: 3 }) });
  next(); assert.equal(f.events.filter(e => e.type === 'wd:ws-obs').length, 2, 'unseen host config pauses weather before async pull');
  f.emit('wd:host-config', { ...f.settings(), _rev: 3 });
  second = f.streams.at(-1);
  f.set({ deviceSerial: 'ST-old', serialDeviceId: '999', hubSerial: 'HB-old' });
  next({ serial_number: 'ST-old', hub_sn: 'HB-old' });
  assert.equal(f.events.filter(e => e.type === 'wd:ws-obs').length, 2, 'old serial binding cannot authorize a different device');
  f.set({ deviceSerial: 'ST-current', serialDeviceId: '111', hubSerial: 'HB-current' });
  next({ serial_number: 'ST-current', hub_sn: 'HB-current' });
  assert.equal(f.events.filter(e => e.type === 'wd:ws-obs').length, 3, 'ack arriving after its SSE revision resumes the feed');
}

// A headless host's verified serial can arrive before local metadata; viewer secrets are redacted.
for (const viewer of [false, true]) {
  const f = fixture();
  f.document.body = { classList: { contains: name => viewer && name === 'public' } };
  const sig = f.load('signals.js');
  f.load('udp.js', { renderRapid: sig.renderRapid, onStrike: sig.onStrike }).initUdp();
  f.emit('wd:host-config', { ...f.settings(), ...(viewer ? { token: '', ingestKey: '', awnApiKey: '' } : {}), _rev: 1 });
  f.streams.at(-1).handlers.udp({ data: JSON.stringify({ type: 'obs_st', serial_number: 'ST-resolved-by-host', hub_sn: 'HB-current', _at: f.now, obs: [tuple(f.now)] }) });
  assert.equal(f.events.filter(e => e.type === 'wd:ws-obs').length, 1, viewer ? 'redacted public config works with an old saved browser token' : 'missing local serial metadata does not discard verified host data');
}

// Tokyo provider wall time on a non-Tokyo device; offsets, explicit zones and stale data.
{
  const f = fixture(); let payload;
  f.api.aqi = async () => payload;
  const desk = f.load('desk.js', { stamp() {} });
  payload = { utc_offset_seconds: 32400, hourly: { time: ['2026-11-19T00:00', '2026-11-19T03:00', '2026-11-19T04:00'], us_aqi: [10, 150, 200], pm2_5: [1, 40, 60] } };
  await desk.refreshAqi(); assert.equal(f.element('aqi-val').textContent, '150');
  payload = { utc_offset_seconds: -21600, hourly: { time: ['2026-11-18T12:00'], us_aqi: [0], pm2_5: [0] } };
  await desk.refreshAqi(); assert.equal(f.element('aqi-val').textContent, '0', 'zero is a real good AQI');
  for (const time of ['2026-11-18T18:00Z', '2026-11-18T12:00-06:00', f.now - 1800]) {
    payload.hourly.time = [time]; payload.hourly.us_aqi = [32];
    await desk.refreshAqi(); assert.equal(f.element('aqi-val').textContent, '32');
  }
  for (const time of ['invalid', f.now - 3600, f.now + 3600]) {
    payload.hourly.time = [time];
    await desk.refreshAqi(); assert.equal(f.element('aqi-val').textContent, '--', 'invalid/expired/future-only AQI is unavailable');
  }
}

console.log('Live data: source switching/reconnect cleanup, safe nearby text, ordered/deduplicated observations, scoped alert holds/strikes, local streams and timezone-correct AQI passed.');
