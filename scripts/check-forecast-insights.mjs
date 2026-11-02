import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { forecastTime } from '../site/js/weather-context.js';

let now = Date.parse('2026-11-01T18:00:00Z');
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
const start = Date.parse('2026-11-01T06:00:00Z') / 1000, end = start + 86400;
const config = { units: 'imperial', lat: 32.7, lon: -97.3, stationId: 'home', stationSource: 'tempest', places: [] };
const settings = () => config, coords = () => ({ lat: config.lat, lon: config.lon });
const U = { temp: () => config.units === 'metric' ? '°C' : '°F', precip: () => config.units === 'metric' ? 'mm' : 'in' };
const num = (value, digits = 0) => Number.isFinite(value) ? value.toFixed(digits) : '—';
const read = name => readFileSync(new URL(`../site/js/${name}.js`, import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const data = new Map();
const track = vm.createContext({ Date: Clock, settings, coords, U, num,
  cacheContext: () => JSON.stringify([config.lat, config.lon, config.stationId, config.units]),
  load: (key, fallback) => data.has(key) ? JSON.parse(data.get(key)) : fallback,
  store: (key, value) => data.set(key, JSON.stringify(value)), localStorage: { removeItem: key => data.delete(key) } });
vm.runInContext(read('track'), track);
const fc = (high = 70, pop = 0) => ({ _forecastSource: 'Open-Meteo', timezone: 'America/Chicago',
  forecast: { daily: [{ day_start_local: start, air_temp_high: high, air_temp_low: 50, precip_probability: pop, conditions: 'Clear' }], hourly: [] } });
const first = fc();
track.snapshot(first);
assert.equal(track.changes(first, 0).age, null, 'A new snapshot cannot compare with itself');
now += 5 * 60e3;
assert.equal(track.changes(fc(), 0).items.length, 0, 'Unchanged values including zero rain remain unchanged');
assert.ok(track.changes(fc(), 0).base, 'A distinct prior forecast is available');
assert.match(track.changes(fc(75, 20), 0).items[0].text, /high 70→75°F.*rain 0%→20%/);
const missing = fc(null, null); missing.forecast.daily[0].conditions = null;
assert.equal(track.changes(missing, 0).items.length, 0, 'Missing measurements are not interpreted as zero or changed conditions');
assert.equal(track.changes({ ...fc(), _cached: true }, 0).age, null, 'Cached forecasts cannot produce fresh change claims');
assert.equal(track.changes(fc()).age, null, 'Existing 20-hour comparison keeps its old default');
config.lon = -90;
assert.equal(track.changes(fc(90), 0).age, null, 'Locations do not compare with one another');
const elsewhere = fc(90); track.snapshot(elsewhere);
assert.equal(JSON.parse(data.get('wd.snap')).length, 2, 'New locations bypass another location’s snapshot gate');
config.lon = -97.3; config.units = 'metric';
assert.equal(track.changes(fc(25), 0).age, null, 'Units cannot mix');
config.units = 'imperial';
assert.equal(track.changes({ ...fc(75), _forecastSource: 'NWS' }, 0).age, null, 'Provider changes are not weather changes');
data.set('wd.snap', JSON.stringify([{ t: now - 3600e3, u: 'i', daily: [{ key: String(start), hi: 0 }] }]));
assert.equal(track.changes(fc(75), 0).age, null, 'Legacy snapshots without location are ignored');
data.set('wd.snap', '{}');
assert.equal(track.changes(fc(), 0).age, null, 'Malformed saved data is harmless');
track.clearAll();
track.snapshot(fc());
now += 21 * 3600e3;
assert.equal(track.changes(fc(75)).items.length, 1, 'Existing long-period change view still works');
const forecastTimeAt = now, target = now / 1000 + 25 * 3600;
const verification = fc(); verification.forecast.hourly.push({ time: target, air_temperature: 70, precip_probability: 0 });
track.recordForecast(verification); config.lon = -90; track.recordForecast(verification);
assert.equal(JSON.parse(data.get('wd.verify')).length, 2, 'Verification targets are isolated by location');
now = target * 1000; track.scoreForecast({ air_temperature: 74, precip_accum_last_1hr: 0 });
assert.equal(track.accuracy().n, 1); config.lon = -97.3;
assert.equal(track.accuracy().n, 0, 'Another station’s observation cannot score this forecast');
track.scoreForecast({ air_temperature: 70, precip_accum_last_1hr: 0 });
assert.equal(track.accuracy().mae, 0, 'Zero forecast error is valid');
now = forecastTimeAt;

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.textContent = ''; this.handlers = {}; this.classList = { add() {} }; }
  append(...nodes) { this.children.push(...nodes); }
  getClientRects() { return this.visible === false ? [] : [{}]; }
  addEventListener(name, handler) { this.handlers[name] = handler; }
}
const events = {}, windowMock = { addEventListener: (name, handler) => (events[name] ||= []).push(handler) };
const documentEvents = {}, documentMock = { hidden: false, createElement: tag => new Element(tag),
  addEventListener: (name, handler) => (documentEvents[name] ||= []).push(handler) };
const emit = async (name, detail) => { for (const handler of events[name] || []) await handler({ detail }); };
const makeModels = () => ({ _fetchedAt: now / 1000, utc_offset_seconds: -21600,
  hourly: { time: Array.from({ length: 25 }, (_, i) => start + i * 3600),
    temperature_2m_a: Array.from({ length: 25 }, (_, i) => i), temperature_2m_b: Array.from({ length: 25 }, (_, i) => i + 5),
    precipitation_a: Array.from({ length: 25 }, (_, i) => i === 0 ? 10 : 0), precipitation_b: Array(25).fill(0.1) },
  hourly_units: { temperature_2m_a: '°F', temperature_2m_b: '°F', precipitation_a: 'inch', precipitation_b: 'inch' } });
let normalCalls = 0, monthlyCalls = 0, modelCalls = 0, fetchModels = () => Promise.resolve(makeModels());
const contextKey = () => JSON.stringify([config.lat, config.lon, config.stationId, config.units]);
const insights = vm.createContext({ Date: Clock, Intl, settings, coords, U, num, forecastTime, window: windowMock,
  document: documentMock, cacheContext: contextKey, forecast: () => fc(),
  multiModel: () => { modelCalls++; return fetchModels(); }, normalToday: async () => { normalCalls++; return { hi: 68, lo: 48 }; },
  monthlyPrecipNormal: async () => { monthlyCalls++; return null; },
  snapshot: track.snapshot, changes: track.changes });
vm.runInContext(read('forecast-insights'), insights);
const result = insights.modelDayRange(makeModels(), start, end);
assert.equal(result.high.min, 23); assert.equal(result.high.max, 28);
assert.equal(result.low.min, 0); assert.equal(result.low.max, 5);
assert.equal(result.rain.min, 0, 'Previous day’s rainfall at midnight is excluded');
assert.ok(Math.abs(result.rain.max - 2.4) < 1e-10, 'Total includes next midnight’s preceding hour');
assert.equal(insights.modelDayRange(makeModels(), start, end, true).available, false, 'Unit mismatch is unavailable');
const stale = makeModels(); stale._fetchedAt = now / 1000 - 4 * 3600;
assert.equal(insights.modelDayRange(stale, start, end).available, false, 'Stale model ranges cannot be current');
const incomplete = makeModels(); incomplete.hourly.temperature_2m_a[4] = null;
delete incomplete.hourly.precipitation_b;
assert.equal(insights.modelDayRange(incomplete, start, end).available, false, 'One complete model cannot imply uncertainty');
const lastDay = makeModels(); lastDay.hourly.time.pop();
assert.equal(insights.modelDayRange(lastDay, start, end).rain, null, 'Missing last rain hour cannot become a daily total');
const duplicateHour = makeModels(); duplicateHour.hourly.time[1] = start;
assert.equal(insights.modelDayRange(duplicateHour, start, end).available, false, 'Duplicate or missing hours cannot form a complete day');
assert.equal(insights.modelDayRange(makeModels(), end, end + 86400).available, false, 'Out-of-range days are not inferred');
const fallDay = makeModels();
for (const values of Object.values(fallDay.hourly)) values.push(values[values.length - 1]);
fallDay.hourly.time[25] = start + 25 * 3600;
assert.equal(insights.modelDayRange(fallDay, start, start + 25 * 3600).available, true, 'A 25-hour day uses the actual day boundaries');
const stringTimes = makeModels(); stringTimes.hourly.time = stringTimes.hourly.time.map(t => new Date((t - 21600) * 1000).toISOString().slice(0, 16));
assert.equal(insights.modelDayRange(stringTimes, start, end).high.min, 23, 'Provider-local timestamps use the supplied offset');
assert.equal(insights.normalComparison({ air_temp_high: 0, air_temp_low: -5 }, { hi: 0, lo: -5 }).high, 0);
assert.equal(insights.normalComparison({ air_temp_high: null, air_temp_low: 0 }, { hi: 1, lo: 0 }), null);
const date = insights.forecastCalendarDate({ timezone: 'Pacific/Kiritimati' }, Date.parse('2026-11-01T10:00:00Z') / 1000);
assert.equal(date.getDate(), 2, 'Normals use destination calendar date even across the date line');
assert.equal(insights.forecastCalendarDate({}, start), null, 'Unknown calendar zone is not guessed');

now = Date.parse('2026-11-01T18:00:00Z');
const host = new Element('div'); insights.initForecastInsights(host);
assert.equal(normalCalls, 0, 'Collapsed climatology does not fetch a 30-year archive');
assert.equal(monthlyCalls, 0, 'Collapsed climatology does not fetch monthly precipitation');
assert.equal(modelCalls, 0, 'Dashboard startup does not fetch additional models');
assert.equal(host.children.length, 2);
insights.initForecastInsights(host); assert.equal(host.children.length, 2, 'Initialization is idempotent');
const climate = host.children[1]; climate.open = true; await climate.handlers.toggle();
assert.equal(normalCalls, 1);
assert.match(climate.children[1].textContent, /modeled daily averages; not station records/);
host.visible = false; config.lat = 33;
await emit('wd:settings'); await emit('wd:forecast', fc()); await emit('wd:section');
assert.equal(normalCalls, 1, 'An expanded card in a hidden app section cannot fetch a new location’s archive');
assert.equal(monthlyCalls, 1, 'Hidden sections cannot fetch monthly precipitation');
host.visible = true; documentMock.hidden = true;
await emit('wd:forecast', fc()); await emit('wd:section');
assert.equal(normalCalls, 1, 'Background browser tabs do not fetch climatology');
documentMock.hidden = false;
for (const handler of documentEvents.visibilitychange) await handler();
assert.equal(normalCalls, 2, 'Returning to a visible open card resumes the deferred comparison');
climate.open = false;
await emit('wd:forecast', fc()); await emit('wd:section');
for (const handler of documentEvents.visibilitychange) await handler();
assert.equal(normalCalls, 2, 'Resume events cannot fetch or reopen a collapsed card');
assert.equal(climate.open, false);
host.visible = false; climate.open = true; await climate.handlers.toggle();
assert.equal(normalCalls, 2);
host.visible = true; await emit('wd:settings');
assert.equal(normalCalls, 3, 'A settings-only return from radar resumes an already expanded card');
climate.open = false; config.lat = 32.7;
await emit('wd:settings'); await emit('wd:forecast', fc());
const modelHost = new Element('p'); await insights.renderDayForecastRange(modelHost, start, end);
assert.equal(modelCalls, 1); assert.match(modelHost.textContent, /not a probability range/);
await insights.renderDayForecastRange(modelHost, start, end); assert.equal(modelCalls, 1, 'Day details reuse fresh models');
config.lon = -85;
assert.equal(insights.dayForecastRange(start, end).available, false, 'Prior-location ranges are invalidated immediately');
let finish; fetchModels = () => new Promise(resolve => { finish = resolve; });
const pending = insights.renderDayForecastRange(modelHost, start, end);
config.lon = -86; finish(makeModels()); await pending;
assert.equal(insights.dayForecastRange(start, end).available, false, 'Requests completing after location switch are discarded');
assert.equal(modelHost.textContent, 'Loading model comparison…', 'An old request cannot write to a changed context');

// Existing climatology cache must coalesce calls and never leak values across location/units.
let resolveNormals, calls = 0;
const almanac = vm.createContext({ Date: Clock, settings, coords, window: windowMock, document: {}, location: { search: '' },
  normals: () => { calls++; return new Promise(resolve => { resolveNormals = resolve; }); },
  normalFor: days => days?.today ?? null });
vm.runInContext(read('almanac'), almanac);
const n1 = almanac.normalToday(), n2 = almanac.normalToday();
assert.equal(calls, 1, 'Normals share one pending fetch');
config.lat = 40; resolveNormals({ today: { hi: 60, lo: 40 } });
assert.equal(await n1, null); assert.equal(await n2, null);
const n3 = almanac.normalToday(); assert.equal(calls, 2);
resolveNormals({ today: { hi: 50, lo: 30 } }); assert.equal((await n3).hi, 50);
config.units = 'metric'; const n4 = almanac.normalToday(); assert.equal(calls, 3);
resolveNormals({ today: { hi: 10, lo: 0 } }); assert.equal((await n4).lo, 0);
// Monthly comparisons require every day, the same baseline period, and matching units.
const archiveDays = (first, last, amount = 2) => {
  const daily = { time: [], precipitation_sum: [] };
  for (const day = new Date(first + 'T00:00:00Z'); day <= new Date(last + 'T00:00:00Z'); day.setUTCDate(day.getUTCDate() + 1)) {
    daily.time.push(day.toISOString().slice(0, 10)); daily.precipitation_sum.push(amount);
  }
  return { daily, daily_units: { precipitation_sum: 'inch' } };
};
const baseline = {};
for (const day = new Date('2000-01-01T00:00:00Z'); day.getUTCFullYear() === 2000; day.setUTCDate(day.getUTCDate() + 1)) {
  const key = day.toISOString().slice(5, 10);
  baseline[key] = { precip: 1, precipYears: key === '02-29' ? 8 : 30 };
}
const partialMonth = archiveDays('2026-11-01', '2026-11-15');
partialMonth.daily.precipitation_sum[14] = 99;
const mtd = almanac.monthlyPrecipComparison(partialMonth, baseline, new Date(2026, 10, 15));
assert.equal(mtd.total, 28); assert.equal(mtd.normal, 14); assert.equal(mtd.days, 14);
assert.equal(mtd.currentMonth, true, 'Current day is excluded and both totals cover identical elapsed days');
const lagged = archiveDays('2026-09-01', '2026-10-31');
lagged.daily.precipitation_sum[lagged.daily.precipitation_sum.length - 1] = null;
const completed = almanac.monthlyPrecipComparison(lagged, baseline, new Date(2026, 10, 1));
assert.equal(completed.start, '2026-09-01'); assert.equal(completed.end, '2026-09-30');
assert.equal(completed.days, 30, 'Archive lag selects the latest fully covered completed month');
assert.equal(almanac.monthlyPrecipComparison(archiveDays('2026-08-01', '2026-08-31'), baseline, new Date(2026, 10, 1)), null, 'Old archives outside the requested period are unavailable');
assert.equal(almanac.monthlyPrecipComparison(partialMonth, baseline, new Date(2026, 10, 15), true), null, 'Archive units must match display units');
const gap = archiveDays('2026-10-01', '2026-10-31'); gap.daily.precipitation_sum[2] = null;
assert.equal(almanac.monthlyPrecipComparison(gap, baseline, new Date(2026, 10, 1)), null, 'Missing archive days never become zero');
const absentBaseline = { ...baseline, '10-03': { precip: null, precipYears: 0 } };
assert.equal(almanac.monthlyPrecipComparison(archiveDays('2026-10-01', '2026-10-31'), absentBaseline, new Date(2026, 10, 1)), null, 'Incomplete baseline coverage is unavailable');
const zeroBaseline = Object.fromEntries(Object.entries(baseline).map(([k, v]) => [k, { ...v, precip: 0 }]));
const dry = almanac.monthlyPrecipComparison(archiveDays('2026-10-01', '2026-10-31', 0), zeroBaseline, new Date(2026, 10, 1));
assert.equal(dry.total, 0); assert.equal(dry.normal, 0, 'True zero rainfall remains a valid comparison');
const january = almanac.monthlyPrecipComparison(archiveDays('2026-12-01', '2026-12-31'), baseline, new Date(2027, 0, 1));
assert.equal(january.start, '2026-12-01', 'January rolls back to the previous year correctly');
const leap = almanac.monthlyPrecipComparison(archiveDays('2024-02-01', '2024-02-29'), baseline, new Date(2024, 2, 1));
assert.equal(leap.days, 29); assert.equal(leap.normal, 29, 'Leap day uses its eight baseline years without smoothing neighbors');

// Exercise the actual api.normals response parser and versioned persistent cache.
let normalPayload, normalUrl = '', normalFetches = 0;
const normalStorage = new Map([['wd.normals', JSON.stringify({ place: '40.00,-86.00,imperial', days: { old: true } })]]);
config.units = 'imperial';
const normalApi = vm.createContext({ settings, coords, URLSearchParams, NORMALS_KEY: 'wd.normals',
  qs: value => new URLSearchParams(value).toString(),
  localStorage: { getItem: k => normalStorage.get(k), setItem: (k, v) => normalStorage.set(k, v) },
  getJSON: async url => { normalUrl = url; normalFetches++; return normalPayload; } });
const apiSource = read('api');
vm.runInContext(apiSource.slice(apiSource.indexOf('async function normals('), apiSource.indexOf('const normalFor =')), normalApi);
const years = Array.from({ length: 30 }, (_, i) => `${1991 + i}-10-01`);
normalPayload = { daily: { time: years, temperature_2m_max: Array(30).fill(70), temperature_2m_min: Array(30).fill(50), precipitation_sum: Array(30).fill(0.5) },
  daily_units: { temperature_2m_max: '°F', temperature_2m_min: '°F', precipitation_sum: 'inch' } };
const averaged = await normalApi.normals();
assert.equal(averaged['10-01'].precip, 0.5); assert.equal(averaged['10-01'].precipYears, 30);
assert.equal(averaged['10-01'].hi, 70); assert.equal(normalFetches, 1, 'Old temperature-only cache is invalidated');
assert.equal(new URL(normalUrl).searchParams.get('models'), 'era5');
assert.equal(new URL(normalUrl).searchParams.get('precipitation_unit'), 'inch');
assert.match(new URL(normalUrl).searchParams.get('daily'), /precipitation_sum/);
await normalApi.normals(); assert.equal(normalFetches, 1, 'New baseline cache avoids another archive fetch');
normalStorage.clear(); normalPayload.daily.precipitation_sum[0] = null;
assert.equal((await normalApi.normals())['10-01'].precipYears, 29, 'Missing baseline years remain missing');
normalStorage.clear(); normalPayload.daily_units = { precipitation_sum: 'mm', temperature_2m_max: '°C', temperature_2m_min: '°C' };
const wrongUnits = await normalApi.normals();
assert.equal(wrongUnits['10-01'].precip, null); assert.equal(wrongUnits['10-01'].hi, null, 'Response units are validated before comparison');
console.log('Forecast insights checks passed: complete model ranges, isolated snapshots, lazy visible climate, monthly coverage/calendar/units and cache guards.');
