import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const now = Date.UTC(2026, 10, 2, 2);
const date = hours => new Date(now + hours * 3600000).toISOString();
const gauge = { lid: 'PTTP1', name: 'Ohio River at Pittsburgh',
  status: { observed: { primary: 17, primaryUnit: 'ft', validTime: date(-1) } },
  flood: { stageUnits: 'ft', categories: { action: { stage: 18 }, minor: { stage: 22 }, moderate: { stage: 25 }, major: { stage: 28 } } } };
const flow = { forecast: { primaryUnits: 'ft', issuedTime: date(-1), data: [
  { validTime: date(-2), primary: 90 }, { validTime: date(2), primary: 19 },
  { validTime: date(6), primary: 23 }, { validTime: date(10), primary: 21 },
  { validTime: date(12), primary: -9999 }, { validTime: date(13), primary: null },
] } };
const area = (impact = 'MINOR', patch = {}) => ({ attributes: { impact, component: 'WSSI_OVERALL',
  issue_time: '2026-11-02 0116Z', start_time: '00Z 11/02/26', end_time: '00Z 11/05/26', ...patch } });
const winter = { features: [area('MINOR'), area('MAJOR')] };
const settings = { riverGauge: 'PTTP1' };
let time = now, calls = [], fail = false;
const context = vm.createContext({ console, URL, URLSearchParams, structuredClone,
  Date: class extends Date { static now() { return time; } },
  settings: () => settings, coords: () => ({ lat: 40.44, lon: -80.01 }),
  addEventListener: () => {}, location: { href: 'https://local.test/' }, expires: () => undefined, errHint: () => '',
  fetch: async url => {
    calls.push(url);
    if (fail) throw Error('offline');
    const body = url.includes('mapservices.') ? winter : url.endsWith('/stageflow') ? flow : gauge;
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  },
});
const apiSource = readFileSync(new URL('../site/js/api.js', import.meta.url), 'utf8');
vm.runInContext(apiSource.slice(apiSource.indexOf('const etags ='), apiSource.indexOf("if (location.search.includes('selftest'))")).replace(/^export /gm, ''), context);
const source = readFileSync(new URL('../site/js/balanced-context.js', import.meta.url), 'utf8');
vm.runInContext(source.replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), context);
const { parseRiverCrest, parseWinterOutlook, riverCrest, winterOutlook, getBalancedContext } = context;

const river = parseRiverCrest(gauge, flow, 'PTTP1', now);
assert.equal(river.status, 'ready');
assert.equal(river.crest, 23, 'future peak excludes past observations and missing sentinels');
assert.equal(river.crestTime, date(6));
assert.equal(river.floodCategory, 'minor');
assert.equal(river.floodStage, 22);
assert.equal(river.observed, 17);
assert.equal(river.series.length, 3);
assert.equal(river.sourceUrl, 'https://water.noaa.gov/gauges/pttp1');
assert.equal(parseRiverCrest(gauge, flow, 'OTHER', now).status, 'unavailable');
assert.equal(parseRiverCrest(gauge, { forecast: { ...flow.forecast, issuedTime: date(-37) } }, 'PTTP1', now).status, 'stale');
assert.equal(parseRiverCrest(gauge, { forecast: { ...flow.forecast, issuedTime: date(1) } }, 'PTTP1', now).status, 'unavailable');
assert.equal(parseRiverCrest(gauge, flow, 'PTTP1', now + 86400000).status, 'unavailable', 'exhausted forecast is not a current crest');
const mismatched = structuredClone(gauge); mismatched.flood.stageUnits = 'm';
assert.equal(parseRiverCrest(mismatched, flow, 'PTTP1', now).floodStage, null, 'thresholds require matching source units');

const outlook = parseWinterOutlook(winter, now);
assert.equal(outlook.status, 'ready');
assert.equal(outlook.impact, 'MAJOR', 'highest overlapping category wins');
assert.equal(outlook.issuedTime, '2026-11-02T01:16:00.000Z');
assert.equal(outlook.validUntil, '2026-11-05T00:00:00.000Z');
assert.equal(parseWinterOutlook({ features: [] }, now).status, 'unavailable', 'no polygon never means clear');
assert.equal(parseWinterOutlook({ error: { code: 500 } }, now).status, 'unavailable');
assert.equal(parseWinterOutlook({ ...winter, exceededTransferLimit: true }, now).status, 'unavailable');
assert.equal(parseWinterOutlook({ features: [area('UNKNOWN')] }, now).status, 'unavailable');
assert.equal(parseWinterOutlook({ features: [area('MAJOR', { end_time: '00Z 02/30/26' })] }, now).status, 'unavailable', 'invalid calendar dates are rejected');
assert.equal(parseWinterOutlook({ features: [area('MAJOR', { end_time: '00Z 11/02/26', start_time: '00Z 11/01/26' })] }, now).status, 'stale');
assert.equal(parseWinterOutlook(winter, now + 7 * 3600000).status, 'stale', 'old WSSI issuance is never a fresh outlook');
assert.equal(parseWinterOutlook({ features: [area('MINOR'), area('EXTREME', { issue_time: '' })] }, now).status, 'unavailable', 'malformed overlap cannot hide a higher category');

assert.equal((await riverCrest('')).status, 'configure');
assert.equal((await riverCrest('../../bad')).status, 'configure');
assert.equal((await winterOutlook(null, -80)).status, 'configure');
assert.equal((await winterOutlook(61, -150)).status, 'outside-coverage');
assert.equal(calls.length, 0, 'unconfigured and unsupported cards make no network requests');
const [first, second] = await Promise.all([getBalancedContext(), getBalancedContext()]);
assert.equal(calls.length, 3, 'shared getJSON deduplicates concurrent card requests');
assert.equal(first.river.crest, second.river.crest);
const query = new URL(calls.find(url => url.includes('mapservices.')));
assert.equal(query.searchParams.get('geometry'), '-80.01,40.44');
assert.equal(query.searchParams.get('spatialRel'), 'esriSpatialRelIntersects');
assert.equal(query.searchParams.get('returnGeometry'), 'false');
first.river.series[0].value = 999;
assert.equal((await riverCrest()).series[0].value, 19, 'a card cannot mutate cached data');
time += 29 * 60000;
await winterOutlook();
assert.equal(calls.length, 3, 'WSSI reuses the existing thirty-minute cache');
time += 2 * 60000;
await winterOutlook();
assert.equal(calls.length, 4, 'expired WSSI cache refreshes');
fail = true;
assert.equal((await winterOutlook(40, -81)).status, 'unavailable', 'network failure is explicit');
fail = false;
assert.equal((await winterOutlook(40, -81)).status, 'ready', 'a rejected request is evicted for retry');
assert.equal((await riverCrest('pttp1')).gauge, 'PTTP1', 'configured gauge identifiers normalize safely');

console.log('balanced context: forecast parsing, provenance, missing data, point queries, caching and retries passed');
