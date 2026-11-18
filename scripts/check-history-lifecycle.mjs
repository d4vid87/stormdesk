import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = name => readFileSync(new URL(`../site/js/${name}.js`, import.meta.url), 'utf8')
  .replace(/^import .*;$/gm, '').replace(/^export /gm, '');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const I = { time: 0, windAvg: 2, windGust: 3, windDir: 4, press: 6, temp: 7, rh: 8, uv: 10, solar: 11, rain: 12, strikes: 15 };
const observation = (value) => { const row = Array(19).fill(0); row[0] = Math.floor(Date.now() / 1000) - 60; row[7] = value; row[8] = 50; return row; };

function harness() {
  const nodes = new Map(), handlers = new Map();
  const listen = (name, fn) => { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(fn); };
  const emit = (name, detail) => handlers.get(name)?.forEach(fn => fn({ detail }));
  const node = id => {
    if (nodes.has(id)) return nodes.get(id);
    const classes = new Set(), attributes = new Map(), listeners = new Map();
    const el = { id, style: {}, dataset: {}, children: [], value: '', textContent: '', innerHTML: '',
      width: 600, height: 180, clientWidth: 600, clientHeight: 180, visible: false,
      classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x), toggle: (x, yes) => yes ? classes.add(x) : classes.delete(x) },
      setAttribute: (k, v) => attributes.set(k, v), getAttribute: k => attributes.get(k), removeAttribute: k => attributes.delete(k),
      addEventListener: (k, fn) => listeners.set(k, fn), fire: (k, event = {}) => listeners.get(k)?.({ preventDefault() {}, ...event }),
      append(...items) { this.children.push(...items); }, prepend(...items) { this.children.unshift(...items); },
      replaceChildren(...items) { this.children = items; }, querySelector: selector => node(id + selector), querySelectorAll: () => [], focus() {},
      getClientRects: () => el.visible ? [{}] : [], getBoundingClientRect: () => ({ left: 0, top: 0, bottom: 100 }),
      getContext: () => new Proxy({ canvas: el, measureText: () => ({ width: 20 }) }, { get: (o, k) => o[k] || (() => {}) }),
    };
    nodes.set(id, el); return el;
  };
  let settings = { stationId: 'A', units: 'imperial', windUnit: 'mph', places: [], lat: 1, lon: 2 };
  const context = vm.createContext({
    console, performance, location: { search: '' }, innerHeight: 900, queueMicrotask,
    document: { hidden: false, getElementById: node, createElement: () => node('created-' + nodes.size), addEventListener: listen,
      querySelector: () => null, querySelectorAll: () => [], documentElement: {}, activeElement: null },
    window: { devicePixelRatio: 1, __WD_SRV: '', addEventListener: listen },
    getComputedStyle: () => ({ getPropertyValue: () => '' }), requestAnimationFrame: fn => { fn(); return 1; },
    settings: () => settings, coords: () => ({ lat: settings.lat, lon: settings.lon }),
    cacheContext: kind => JSON.stringify([kind, settings.stationId, settings.lat, settings.lon, settings.units, settings.windUnit]),
    api: { OBS: I, MODELS: 'gfs_seamless', stationContext: () => settings.stationId },
    U: { temp: () => '°F', precip: () => 'in', wind: () => 'mph', press: () => 'inHg' },
    num: (x, digits = 0) => Number.isFinite(x) ? x.toFixed(digits) : '—', msToWind: x => x,
    configured: () => true, hasSource: () => true, accuracy: () => ({ recent: [], n: 0 }),
    deskForecast: () => ({ station: settings.stationId, forecast: { daily: [] } }), openDetail() {}, every() {}, expires() {},
  });
  return { context, node, emit, change: patch => { settings = { ...settings, ...patch }; }, state: () => settings };
}

// Use the actual chart engine: clearing must replace its closures and accessible samples, not only pixels.
const boards = harness();
vm.runInContext(source('charts') + '\n' + source('boards'), boards.context);
boards.node('history-compare').value = 'none';
const canvas = boards.node('c-temp');
boards.context.chart(canvas, [{ data: [{ x: 1, y: 99 }, { x: 2, y: 100 }], color: '#fff' }], { label: 'Old station', onPick() { throw Error('stale pick'); } });
boards.context.clearSnapshot();
canvas._wdDraw(); canvas.fire('keydown', { key: 'Enter' }); canvas.fire('click', { clientX: 100, clientY: 20 });
assert.equal(canvas._wdAccessible.rows.length, 0);
assert.equal(canvas._wdPrepared.high, -Infinity);
assert.equal(canvas.getAttribute('aria-label'), 'Temperature: no data');
assert.equal(canvas._wdAccessible.live.textContent, 'No chart data available.');
const requests = [];
boards.context.api.localObs = () => { const request = deferred(); requests.push(request); return request.promise; };
const oldHistory = boards.context.refreshBoards();
boards.change({ stationId: 'B' }); boards.emit('wd:settings');
const newHistory = boards.context.refreshBoards();
requests[1].resolve({ obs: [observation(20)] }); await newHistory;
requests[0].resolve({ obs: [observation(99)] }); await oldHistory;
assert.equal(canvas._wdPrepared.high, 20, 'late old-station history cannot repaint the current board');
boards.change({ stationId: 'C' }); boards.emit('wd:settings');
assert.equal(canvas._wdAccessible.rows.length, 0, 'switch clears samples before the replacement request finishes');
const failedHistory = boards.context.refreshBoards(); requests[2].reject(Error('offline')); await failedHistory;
canvas._wdDraw(); assert.equal(canvas._wdAccessible.rows.length, 0, 'failed new station stays empty after resize/hover');

const modelRequests = [];
boards.context.api.multiModel = () => { const request = deferred(); modelRequests.push(request); return request.promise; };
const oldModels = boards.context.drawModels();
boards.change({ units: 'metric' }); boards.emit('wd:settings');
const newModels = boards.context.drawModels();
const model = value => ({ hourly: { time: ['2026-11-18T12:00:00Z'], temperature_2m_gfs_seamless: [value] } });
modelRequests[1].resolve(model(10)); await newModels; modelRequests[0].resolve(model(90)); await oldModels;
assert.equal(boards.node('c-models')._wdPrepared.high, 10, 'late model analysis cannot restore old units');
const qpfRequests = [];
boards.context.fetch = () => { const request = deferred(); qpfRequests.push(request); return request.promise; };
const oldOutlook = boards.context.drawOutlook();
boards.change({ units: 'imperial', lat: 3 }); boards.emit('wd:settings');
const newOutlook = boards.context.drawOutlook();
const qpf = value => ({ json: async () => ({ daily: { time: ['2026-11-18'], precipitation_sum: [value] } }) });
qpfRequests[1].resolve(qpf(2)); await newOutlook; qpfRequests[0].resolve(qpf(40)); await oldOutlook;
assert.equal(boards.node('c-qpf')._wdPrepared.high, 2, 'late QPF cannot repaint the new location/unit');
const points = [];
boards.context.api.nwsPoint = () => { const request = deferred(); points.push(request); return request.promise; };
const oldOfficial = boards.context.drawOfficial();
boards.change({ lat: 4 }); boards.emit('wd:settings');
const newOfficial = boards.context.drawOfficial();
boards.context.fetch = async () => ({ json: async () => ({ properties: { periods: [{ name: 'New place', temperature: 60, temperatureUnit: 'F' }] } }) });
points[1].resolve({ properties: { forecast: 'new' } }); await newOfficial;
points[0].resolve({ properties: { forecast: 'old' } }); await oldOfficial;
assert.equal(boards.node('official').children[0].children[0].textContent, 'New place', 'late NWS point cannot replace the new place');

const detail = harness();
vm.runInContext(source('charts') + '\n' + source('detail'), detail.context);
const detailRequests = [];
detail.context.api.localObs = () => { const request = deferred(); detailRequests.push(request); return request.promise; };
const first = detail.context.openDetail('temp'); detailRequests[0].resolve({ obs: [observation(65)] }); await first;
assert.equal(detail.node('detail-chart')._wdPrepared.high, 65);
const second = detail.context.openDetail('rh');
assert.equal(detail.node('detail-chart')._wdAccessible.rows.length, 0, 'opening a new metric clears the old plot immediately');
detailRequests[1].resolve({ obs: [] }); await second;
detail.node('detail-chart')._wdDraw(); assert.equal(detail.node('detail-chart')._wdAccessible.rows.length, 0, 'empty archive does not revive another metric');
const failed = detail.context.openDetail('temp'); detailRequests[2].reject(Error('offline')); await failed;
assert.equal(detail.node('detail-chart')._wdAccessible.rows.length, 0, 'failed detail leaves no old samples');
const switched = detail.context.openDetail('temp'); detail.change({ stationId: 'B' }); detail.emit('wd:settings');
detailRequests[3].resolve({ obs: [observation(100)] }); await switched;
assert.equal(detail.node('detail-chart')._wdAccessible.rows.length, 0);
assert.equal(detail.node('detail').classList.contains('open'), false, 'station switch dismisses outdated metric context');

const timeline = harness(), batches = [];
let latest, built, registered = 0;
timeline.node('timeline-list').visible = true;
timeline.context.savedTimelineSettings = s => ({ precip: 30, ...(s.timeline || {}) });
timeline.context.every = () => { registered++; };
timeline.context.api.localObs = () => { latest = { obs: deferred(), alerts: deferred(), air: deferred(), near: deferred() }; batches.push(latest); return latest.obs.promise; };
timeline.context.api.alerts = () => latest.alerts.promise;
timeline.context.api.aqi = () => latest.air.promise;
timeline.context.api.nowcast = () => latest.near.promise;
timeline.context.recordBuild = input => { built = input; return []; };
vm.runInContext(source('timeline') + '\nbuildTimeline = recordBuild; render = () => {};', timeline.context);
const settle = (batch, value, fail = []) => {
  for (const [name, result] of Object.entries({ obs: { obs: [[value]] }, alerts: { features: [value] }, air: { value }, near: null })) {
    fail.includes(name) ? batch[name].reject(Error('offline')) : batch[name].resolve(result);
  }
};
const a = timeline.context.refresh();
timeline.change({ stationId: 'B', lat: 3 }); timeline.emit('wd:settings');
const b = timeline.context.refresh();
settle(batches[1], 'B'); await b; settle(batches[0], 'A'); await a; await flush();
assert.equal(built.forecast.station, 'B'); assert.equal(built.observations[0][0], 'B', 'stale station A must never land after B');
timeline.change({ stationId: 'C', lat: 5 }); timeline.emit('wd:settings');
const c = timeline.context.refresh(); settle(batches[2], 'C', ['obs', 'alerts', 'air']); await c;
assert.equal(built.observations.length, 0); assert.equal(built.nws.length, 0); assert.equal(built.air, null, 'new place failures cannot borrow previous place air/alerts');
const before = batches.length;
timeline.change({ palette: 'violet', density: 'compact', motion: 'off' }); timeline.emit('wd:settings');
timeline.context.initTimeline(); timeline.context.initTimeline(); await flush();
assert.equal(batches.length, before, 'cosmetic saves do not fetch history/alerts/AQI/nowcast');
assert.equal(registered, 1, 'settings reinitialization cannot reinstall the polling job');
timeline.emit('wd:forecast'); timeline.emit('wd:forecast'); timeline.emit('wd:models', { _context: timeline.context.cacheContext('models') }); await flush();
assert.equal(batches.length, before + 1, 'forecast/model burst is coalesced');
const pending = timeline.context.refresh(); timeline.emit('wd:forecast'); await flush();
assert.equal(batches.length, before + 1, 'same-context in-flight request is shared');
settle(batches.at(-1), 'C'); await pending;
timeline.change({ stationId: 'D' }); timeline.emit('wd:settings');
const sameLocation = timeline.context.refresh(); settle(batches.at(-1), 'D', ['obs', 'alerts', 'air']); await sameLocation;
assert.equal(built.observations.length, 0, 'different station cannot retain station history');
assert.equal(built.nws[0], 'C'); assert.equal(built.air.value, 'C', 'same-location alerts and AQI remain valid during station-only outages');
timeline.node('timeline-list').visible = false;
const hiddenCount = batches.length;
timeline.emit('wd:forecast'); await flush(); await timeline.context.refresh();
assert.equal(batches.length, hiddenCount, 'hidden timeline and strip do no network work');
timeline.node('timeline-strip').visible = true; timeline.emit('wd:section', 'desk'); await flush();
assert.equal(batches.length, hiddenCount + 1, 'visible strip refreshes deferred data');
const visibleWork = timeline.context.refresh(); settle(batches.at(-1), 'D'); await visibleWork;
timeline.emit('wd:models', { _context: 'old place' }); await flush();
assert.equal(batches.length, hiddenCount + 1, 'obsolete model event cannot trigger work');
let awayArchiveRequests = 0;
timeline.context.api.localObs = async () => { awayArchiveRequests++; return { obs: [['home']] }; };
timeline.context.api.alerts = async () => ({ features: [] });
timeline.context.api.aqi = timeline.context.api.nowcast = async () => null;
timeline.change({ activePlace: 'away' }); timeline.emit('wd:settings'); await timeline.context.refresh();
assert.equal(awayArchiveRequests, 0); assert.equal(built.observations.length, 0, 'destination timeline cannot borrow home station measurements');

const intel = harness(), intelRequests = [], modelEvents = [];
intel.context.CustomEvent = class { constructor(type, { detail }) { this.type = type; this.detail = detail; } };
intel.context.window.dispatchEvent = event => modelEvents.push(event.detail);
intel.context.api.multiModel = () => { const request = deferred(); intelRequests.push(request); return request.promise; };
vm.runInContext(source('intel') + '\nrenderAgreement = renderTiming = renderEdge = () => {};', intel.context);
const olderModel = intel.context.refreshModels(), newerModel = intel.context.refreshModels();
intelRequests[1].resolve(model(20)); await newerModel; intelRequests[0].resolve(model(10)); await olderModel;
assert.equal(modelEvents.length, 1, 'out-of-order same-context model requests publish only the newest response');
assert.equal(modelEvents[0]._context, intel.context.cacheContext('models'), 'model events identify their source context');
const changedWind = intel.context.refreshModels(); intel.change({ windUnit: 'kmh' });
intelRequests[2].resolve(model(50)); await changedWind;
assert.equal(modelEvents.length, 1, 'old wind units cannot publish model guidance');

const fx = harness(), frames = new Map(); let frame = 0, draws = 0, resized, motion = 'full';
const hero = fx.node('hero'), weatherCanvas = fx.node('weather-canvas');
weatherCanvas.getContext = () => new Proxy({ canvas: weatherCanvas, clearRect: () => { draws++; } }, { get: (o, k) => o[k] || (() => {}) });
fx.context.document.createElement = () => weatherCanvas;
fx.context.motionLevel = () => motion; fx.context.addEventListener = () => {};
fx.context.requestAnimationFrame = fn => { frames.set(++frame, fn); return frame; };
fx.context.cancelAnimationFrame = id => frames.delete(id);
fx.context.window.ResizeObserver = fx.context.ResizeObserver = class { constructor(fn) { resized = fn; } observe() {} };
vm.runInContext(source('fx'), fx.context);
fx.context.setScene('rainy'); const cleared = draws;
for (let i = 0; i < 300; i++) { const queued = [...frames.values()]; frames.clear(); queued.forEach(fn => fn(i * 1000 / 60)); }
assert.equal(frames.size, 0); assert.equal(draws, cleared, 'CSS-hidden legacy hero has no drawing loop');
weatherCanvas.visible = true; resized(); assert.equal(frames.size, 1, 'visible legacy hero still animates');
weatherCanvas.visible = false; resized(); assert.equal(frames.size, 0, 'layout hiding the hero immediately stops frames');
weatherCanvas.visible = true; fx.context.document.hidden = true; fx.context.setScene('rainy');
assert.equal(frames.size, 0); fx.context.document.hidden = false; fx.emit('visibilitychange'); assert.equal(frames.size, 1);
motion = 'off'; fx.emit('wd:motion', 'off'); assert.equal(frames.size, 0, 'resolved OS motion policy stops visible legacy particles');
motion = 'full'; fx.emit('wd:motion', 'full'); assert.equal(frames.size, 1);
fx.emit('wd:section', 'data'); assert.equal(frames.size, 0, 'other tabs stop legacy hero animation');

console.log('History lifecycle: chart/detail empty states, source/analysis races, timeline context isolation/coalescing/visibility and hidden hero animation passed.');
