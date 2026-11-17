import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';

const source = name => readFileSync(new URL(`../site/js/${name}.js`, import.meta.url), 'utf8');
const part = (text, start, end) => text.slice(text.indexOf(start), text.indexOf(end)).replace(/^export /gm, '');
const pro = source('pro');
const setText = part(pro, 'const setText =', 'function gauge(');
const escapeText = part(pro, 'const escapeText =', 'function renderTicker(');

// Run the production animation loop against explicit frame times, including long page uptime.
const frames = new Map(); let frameId = 0;
const motion = vm.createContext({
  window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) },
  document: { hidden: false }, location: { search: '?motion=lite' }, URLSearchParams,
  safeMode: () => false, settings: () => ({}), ecoOn: () => false, num: String,
  requestAnimationFrame: fn => { frames.set(++frameId, fn); return frameId; },
});
vm.runInContext(source('motion').split('// --- FLIP ---')[0].replace(/^import .*;$/gm, '').replace(/^export /gm, ''), motion);
const tickFrame = at => { const queued = [...frames.values()]; frames.clear(); queued.forEach(fn => fn(at)); };
const reading = { _v: 1, textContent: '1' };
motion.tweenNumber(reading, 5, String);
tickFrame(10000); assert.equal(reading.textContent, '1', 'animation starts at its first frame, not page navigation');
tickFrame(10300); assert.ok(+reading.textContent > 1 && +reading.textContent < 5, 'animation has an intermediate value');
tickFrame(10600); assert.equal(reading.textContent, '5'); assert.equal(frames.size, 0, 'finished animations stop scheduling');
motion.tweenNumber(reading, 10, String); tickFrame(20000);
motion.document.hidden = true; motion.tweenNumber(reading, 7, String); tickFrame(20300);
assert.equal(reading.textContent, '7', 'hidden-tab updates cancel obsolete animation');
assert.equal(frames.size, 0);

const render = vm.createContext({
  performance, deskForecast: () => ({}), renderHero() {}, renderTicker() {}, renderTrends() {}, render48() {},
  renderDays: () => false, renderGauges() {}, $: () => ({ getClientRects: () => [] }),
});
vm.runInContext(part(pro, 'export function renderPro(', '// ---------- UDP-only'), render);
performance.mark('unrelated-audit-mark');
for (let i = 0; i < 1000; i++) render.renderPro({});
const entries = performance.getEntries().filter(e => e.name.startsWith('renderPro'));
assert.equal(entries.length, 3, '1000 refreshes retain only the latest two marks and measure');
assert.equal(entries.filter(e => e.entryType === 'measure').length, 1);
assert.equal(performance.getEntriesByName('unrelated-audit-mark').length, 1, 'other instrumentation is preserved');
for (const name of ['renderPro-start', 'renderPro-end', 'unrelated-audit-mark']) performance.clearMarks(name);
performance.clearMeasures('renderPro');

let now = new Date(2026, 10, 17, 13, 22, 0).getTime(), tick, constructors = 0, writes = 0;
const nodes = new Map();
const element = id => {
  if (!nodes.has(id)) nodes.set(id, { value: '', get textContent() { return this.value; }, set textContent(v) { this.value = v; writes++; } });
  return nodes.get(id);
};
let clockSettings = { clock24: '12' };
const clock = vm.createContext({
  settings: () => clockSettings, $: element, document: { getElementById: element }, every: (_, seconds, fn) => { assert.equal(seconds, 1); tick = fn; },
  Date: class extends Date { constructor() { super(now); } },
  Intl: { DateTimeFormat: function (...args) { constructors++; return new Intl.DateTimeFormat(...args); } },
});
vm.runInContext(setText + part(pro, 'export function registerClock(', 'export function initPro('), clock);
clock.registerClock();
for (let i = 0; i < 60; i++) { tick(); now += 1000; }
assert.equal(constructors, 3, 'one formatter set per minute, not per second');
assert.equal(writes, 62, 'date and zone each update once; seconds still tick');
assert.equal(element('clock-time').textContent, new Date(now - 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }));
tick(); assert.equal(constructors, 6, 'refresh cached device locale/timezone at the next minute');
clockSettings = { clock24: '24' }; clock.registerClock(); tick();
assert.equal(element('clock-time').textContent, new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }), 'clock preference changes immediately');
const beforeWrites = writes, started = performance.now();
for (let i = 0; i < 1000; i++) tick();
const clockMillis = performance.now() - started;
assert.equal(writes, beforeWrites, 'unchanged clock text does not rewrite DOM');

const hostile = '<img src=x onerror="alert(1)"><script>alert(2)</script>&';
let tickerHtml = '', alerts = [[hostile, hostile]];
const ticker = vm.createContext({
  $: () => ({ classList: { add() {} } }), stormMode: () => true,
  severeAlerts: () => alerts, writeTicker: html => { tickerHtml = html; },
});
vm.runInContext(escapeText + part(pro, 'function renderTicker(', 'function writeTicker('), ticker);
ticker.renderTicker({});
assert.ok(!/<(?:img|script)\b/i.test(tickerHtml), 'provider alert text never becomes HTML');
assert.ok(tickerHtml.includes('&lt;script&gt;') && tickerHtml.includes('&amp;'));
alerts = [[null, null]]; ticker.renderTicker({}); assert.ok(tickerHtml.includes('WEATHER ALERT'));
const healthNode = { innerHTML: '' };
const health = vm.createContext({
  $: () => healthNode, window: {}, Date,
  api: { getJSON: async () => ({ [hostile]: { at: Date.now() / 1000, ok: true, rows: hostile, what: hostile } }) },
});
vm.runInContext(escapeText + part(pro, 'async function renderHealth(', '// Re-registered'), health);
await health.renderHealth();
assert.ok(!healthNode.innerHTML.includes(hostile));
assert.ok(healthNode.innerHTML.includes('&quot;'), 'diagnostic attribute quotes are escaped');

const boards = source('boards');
const dom = () => ({ children: [], textContent: '', append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; } });
const boardNodes = new Map();
const boardNode = id => { if (!boardNodes.has(id)) boardNodes.set(id, dom()); return boardNodes.get(id); };
let period = { name: hostile, startTime: new Date(now).toISOString(), isDaytime: true, temperature: 68, temperatureUnit: 'F' }, rejectFetch = false;
const board = vm.createContext({
  $: boardNode, document: { createElement: dom }, Date, settings: () => ({ units: 'metric' }),
  num: v => v == null ? '--' : (+v).toFixed(0), expires() {},
  deskForecast: () => ({ forecast: { daily: [{ day_start_local: now / 1000, air_temp_high: 20 }] } }),
  api: { nwsPoint: async () => ({ properties: { forecast: '/nws' } }) },
  fetch: async () => { if (rejectFetch) throw Error(hostile); return { json: async () => ({ properties: { periods: [period] } }) }; },
});
vm.runInContext(part(boards, 'const note =', 'const values =') + part(boards, 'async function drawOfficial(', 'async function drawOutlook('), board);
await board.drawOfficial();
assert.equal(boardNode('official').children[0].children[0].textContent, hostile, 'provider name is literal text');
assert.equal(boardNode('official').children[0].children[1].textContent, 'NWS 20° · Tempest 20° (+0)', 'official comparison uses matching temperature units');
period.temperature = hostile; await board.drawOfficial();
assert.equal(boardNode('official').children[0].children[1].textContent, 'NWS --° · Tempest 20°', 'invalid temperature is unavailable');
rejectFetch = true; await board.drawOfficial();
assert.equal(boardNode('official').children[0].textContent, `NWS gridpoint unavailable: ${hostile}`, 'network errors are literal text');
assert.equal(boardNode('official').children[0].className, 'muted');
console.log(`UI lifecycle: animation timing, bounded diagnostics (3 entries/1000 renders), clock formatter reuse (3/minute, 62 writes/60 seconds; ${clockMillis.toFixed(1)}ms/1000 repeated ticks), provider text safety and unit-correct NWS comparisons passed.`);
