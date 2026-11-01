import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Keep provider checks independent of the browser's settings/document bootstrap.
const source = (await readFile(new URL('../site/js/weather-providers.js', import.meta.url), 'utf8'))
  .replace("import { getJSON } from './api.js';", "const getJSON = () => { throw Error('Unexpected network access'); };");
const { pollen, river, canadaAlerts, normalizeLocalAir, localAir } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const now = Date.parse('2026-06-01T12:00:00Z');
const iso = delta => new Date(now + delta).toISOString();
assert.equal((await pollen(40, -90)).available, false);
await assert.rejects(pollen(null, 12), /location/);
let requested;
const poll = await pollen(50, 10, async url => { requested = url; return { hourly: { time: [now / 1000, now / 1000 + 3600], grass_pollen: [0, 12], birch_pollen: [null, null] } }; }, now);
assert.match(requested, /timeformat=unixtime/);
assert.equal(poll.available, true); assert.equal(poll.series.grass[0].value, 0); assert.equal(poll.series.birch.length, 0);
assert.equal((await pollen(50, 10, async () => ({ hourly: { time: [now / 1000 - 86400], grass_pollen: [12] } }), now)).available, false);
await assert.rejects(pollen(50, 10, async () => ({ hourly: { time: [2, 1] } }), now), /Invalid/);

const gauge = { lid: 'PTTP1', name: 'Ohio River', status: { observed: { primary: 17, primaryUnit: 'ft', validTime: iso(-60000) } }, flood: { stageUnits: 'ft', categories: { action: { stage: 18 }, minor: { stage: 22 }, major: { stage: -9999 } } } };
const flow = { observed: { primaryUnits: 'ft', data: [{ validTime: iso(-60000), primary: 17 }, { validTime: iso(-120000), primary: -999 }, { validTime: iso(60000), primary: 18 }] } };
const r = await river('pttp1', async url => url.endsWith('/stageflow') ? flow : gauge, now);
assert.equal(r.level, 17); assert.equal(r.stale, false); assert.equal(r.thresholds.major, null); assert.equal(r.history.length, 1);
assert.equal((await river('PTTP1', async url => url.endsWith('/stageflow') ? flow : { ...gauge, status: { observed: { primary: -9999, primaryUnit: 'ft', validTime: iso(-86400000) } } }, now)).stale, true);
await assert.rejects(river('../private'), /identifier/);

const polygon = { type: 'Polygon', coordinates: [[[-80, 40], [-70, 40], [-70, 50], [-80, 50], [-80, 40]]] };
const warning = { type: 'Feature', geometry: polygon, properties: { id: '1', alert_name_en: 'Rainfall warning', alert_text_en: 'Official unchanged text.', expiration_datetime: iso(3600000), publication_datetime: iso(-3600000), validity_datetime: iso(-3600000), feature_name_en: 'Test region', alert_type: 'warning', risk_colour_en: 'yellow' } };
const ended = { ...warning, properties: { ...warning.properties, status_en: 'ended' } };
const expired = { ...warning, properties: { ...warning.properties, expiration_datetime: iso(-1) } };
const outside = { ...warning, geometry: { type: 'Point', coordinates: [-75, 45] } };
const ca = await canadaAlerts(45, -75, async () => ({ features: [warning, warning, ended, expired, outside] }), now);
assert.equal(ca.features.length, 1); assert.equal(ca.features[0].properties.description, 'Official unchanged text.');
assert.equal(ca.features[0].properties.severity, 'Unknown'); assert.equal(ca.features[0].properties.riskColour, 'yellow');
const hole = { ...warning, geometry: { type: 'Polygon', coordinates: [...polygon.coordinates, [[-76, 44], [-74, 44], [-74, 46], [-76, 46], [-76, 44]]] } };
assert.equal((await canadaAlerts(45, -75, async () => ({ features: [hole] }), now)).features.length, 0);
await assert.rejects(canadaAlerts(45, -75, async () => ({ features: [], links: [{ rel: 'next', href: 'https://evil.test/' }] }), now), /pagination/);

const air = { DateTime: '2026/06/01T11:59:00z', pm2_5_atm: 10, pm2_5_atm_b: 20 };
assert.equal(normalizeLocalAir(air, now).pm25, 15); assert.equal(normalizeLocalAir(air, now).available, true);
assert.equal(normalizeLocalAir({ ...air, DateTime: iso(-3600000) }, now).available, false);
assert.equal(normalizeLocalAir({ ...air, DateTime: iso(3600000) }, now).available, false);
assert.equal(normalizeLocalAir({ DateTime: iso(-1), pm2_5_atm: null, pm2_5_atm_b: '' }, now).pm25, null);
assert.equal(normalizeLocalAir({ ...air, pm2_5_atm: -1 }, now).pm25, 20);
assert.equal((await localAir(async url => { assert.equal(url, '/environment/air'); return air; }, now)).aqi, null);
console.log('Weather provider checks passed: coverage, timestamps, missing readings, safe pagination and official warning text.');
