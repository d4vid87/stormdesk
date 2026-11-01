import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as weather from '../site/js/weather-context.js';

const functionSource = (file, name) => {
  const source = readFileSync(new URL('../site/js/' + file, import.meta.url), 'utf8');
  const start = source.indexOf('export async function ' + name + '(');
  return source.slice(start, source.indexOf('\n}', start) + 2).replace('export ', '');
};
const now = Date.UTC(2026, 0, 1, 12), notices = [], events = [], rendered = [];
let place = { lat: 35, lon: -97 }, payload, response;
const nodes = new Map();
const context = vm.createContext({
  ...weather, Date: class extends Date { static now() { return now; } },
  settings: () => place, coords: () => place,
  $: id => { if (!nodes.has(id)) nodes.set(id, {}); return nodes.get(id); },
  api: { nowcast: async () => payload, alerts: () => response },
  notify: n => notices.push(n), renderHeroAlerts: (...args) => rendered.push(args),
  window: { dispatchEvent: e => events.push(e) }, CustomEvent: class { constructor(type, data) { this.type = type; Object.assign(this, data); } },
  stamp: () => {}, setStorm: () => {}, syncSpokenAlerts: () => {}, dismissStale: () => {},
});
vm.runInContext(functionSource('intel.js', 'refreshNowcast') + '\n' + functionSource('desk.js', 'refreshAlerts'), context);
const forecast = (minutes, precipitation) => ({ minutely_15: {
  time: minutes.map(m => new Date(now + m * 60000).toISOString()), precipitation,
} });
const cases = [
  {}, forecast([], []), forecast([0], [0]), forecast([-120, -60], [1, 0]),
  forecast([0, 15], [0]), forecast([0, 15], [0, null]),
  forecast([0, 15], [0, -1]), forecast([0, 30], [0, 1]),
  forecast([60, 75], [0, 1]), forecast([15, 0], [0, 1]), forecast([0, 0], [0, 1]),
  {minutely_15:{time:['invalid'],precipitation:[1]}}, null,
];
for (const data of cases) {
  payload = data; notices.length = 0;
  await context.refreshNowcast();
  assert.match(nodes.get('nowcast').textContent, /Nowcast unavailable/);
  assert.equal(notices.length, 0, 'invalid nowcast must not notify');
}
for (const [rain, expected] of [[[0, 1, 1], 'starts in ~15 min'], [[1, 0, 0], 'ends in ~15 min']]) {
  payload = forecast([0, 15, 30], rain); notices.length = 0;
  await context.refreshNowcast();
  assert.ok(nodes.get('nowcast').textContent.includes(expected)); assert.equal(notices.length, 1);
}
payload = forecast([0, 15, 30], [0, 0, 0]); notices.length = 0;
await context.refreshNowcast();
assert.ok(!nodes.get('nowcast').textContent.includes('12 hours'), 'short coverage cannot promise twelve dry hours');
assert.equal(notices.length, 0);
payload = { utc_offset_seconds: -21600, minutely_15: { time: ['2026-01-01T06:00', '2026-01-01T06:15'], precipitation: [0, 1] } };
await context.refreshNowcast(); assert.match(nodes.get('nowcast').textContent, /15 min/);

payload = {minutely_15:{time:[now/1000, now/1000+900],precipitation:[1,1]}};
await context.refreshNowcast(); assert.match(nodes.get('nowcast').textContent, /throughout the available/);
context.api.nowcast = async () => { throw Error('network down'); };
await assert.rejects(context.refreshNowcast(), /network down/);
assert.equal(nodes.get('nowcast').textContent, 'Nowcast unavailable');
let finishNowcast;
context.api.nowcast = () => new Promise(resolve => { finishNowcast=resolve; });
const oldNowcast = context.refreshNowcast();
place = {lat:40,lon:-75}; nodes.get('nowcast').textContent='New location';
finishNowcast(forecast([0,15],[0,1])); await oldNowcast;
assert.equal(nodes.get('nowcast').textContent,'New location');

for (const failure of ['503 offline', '404 unsupported']) {
  let rejectOld;
  place = { lat: 35, lon: -97 };
  response = new Promise((_, reject) => { rejectOld = reject; });
  const old = context.refreshAlerts();
  place = { lat: 40, lon: -75 };
  response = Promise.resolve({ features: [{properties:{event:'Tornado Warning',severity:'Extreme',areaDesc:'New location',description:'Take shelter',expires:new Date(now+3600000).toISOString()}}] }); await context.refreshAlerts();
  const before = JSON.stringify([events, rendered, nodes.get('alerts')]);
  rejectOld(Error(failure)); await old;
  assert.equal(JSON.stringify([events, rendered, nodes.get('alerts')]), before, 'old-location failure must not replace current alerts');
}
response = Promise.reject(Error('503 offline'));
await assert.rejects(context.refreshAlerts(), /503/);
assert.equal(events.at(-1).type, 'wd:alerts-error');
assert.match(nodes.get('alerts').textContent, /unavailable/, 'current-location failures remain visible');
console.log('Weather reliability: invalid/expired nowcasts, coverage, timezone, valid transitions and old-location alert failures passed.');
