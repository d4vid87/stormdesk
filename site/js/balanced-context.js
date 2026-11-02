import { getJSON } from './api.js';
import { coords, settings } from './app.js';

const RIVER_SOURCE = { source: 'NOAA NWPS', sourceUrl: 'https://water.noaa.gov/' };
const WINTER_SOURCE = { source: 'NOAA WPC · WSSI', sourceUrl: 'https://www.weather.gov/wssi/' };
const WSSI_QUERY = 'https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/wpc_wssi/MapServer/4/query';
const IMPACTS = ['WINTER WEATHER AREA', 'MINOR', 'MODERATE', 'MAJOR', 'EXTREME'];
const number = value => (typeof value === 'number' || typeof value === 'string' && value.trim()) && Number.isFinite(Number(value)) && ![-999, -9999].includes(Number(value)) ? Number(value) : null;
const stamp = value => typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
const iso = time => Number.isFinite(time) ? new Date(time).toISOString() : null;

function riverSource(gauge) {
  return { ...RIVER_SOURCE, gauge, sourceUrl: /^[A-Z0-9]{3,8}$/.test(gauge) ? `https://water.noaa.gov/gauges/${gauge.toLowerCase()}` : RIVER_SOURCE.sourceUrl };
}

export function parseRiverCrest(metadata, flow, gauge, now = Date.now()) {
  const base = { ...riverSource(gauge), name: '', status: 'unavailable', label: 'Forecast unavailable',
    summary: 'No current forecast is available for the selected gauge.' };
  if (!metadata || typeof metadata.name !== 'string' || String(metadata.lid).toUpperCase() !== gauge) return base;
  base.name = metadata.name;
  const forecast = flow?.forecast, issued = stamp(forecast?.issuedTime);
  const unit = forecast?.primaryUnits;
  if (typeof unit !== 'string' || !unit.trim() || !Number.isFinite(issued) || issued > now + 300000 || !Array.isArray(forecast.data)) return base;
  const series = forecast.data.flatMap(point => {
    const time = stamp(point?.validTime), value = number(point?.primary);
    return value !== null && time >= now && time <= now + 14 * 86400000 ? [{ time, value }] : [];
  }).sort((a, b) => a.time - b.time);
  if (!series.length) return base;
  const peak = series.reduce((best, point) => point.value > best.value ? point : best);
  const thresholdType = metadata.flood?.stageUnits === unit ? 'stage' : metadata.flood?.flowUnits === unit ? 'flow' : null;
  const thresholds = Object.fromEntries(['action', 'minor', 'moderate', 'major'].map(name => [
    name, thresholdType ? number(metadata.flood?.categories?.[name]?.[thresholdType]) : null,
  ]));
  const floodCategory = ['major', 'moderate', 'minor', 'action'].find(name => thresholds[name] !== null && peak.value >= thresholds[name]) || null;
  const observedTime = stamp(metadata.status?.observed?.validTime);
  const observed = metadata.status?.observed?.primaryUnit === unit && observedTime <= now + 300000 && now - observedTime <= 2 * 3600000
    ? number(metadata.status.observed.primary) : null;
  const stale = now - issued > 36 * 3600000;
  return { ...base, status: stale ? 'stale' : 'ready', label: stale ? 'Stale river forecast' : `${peak.value.toFixed(1)} ${unit}`,
    summary: `Highest forecast level at ${metadata.name}. Selected gauge only; not property flood risk.`,
    crest: peak.value, crestTime: iso(peak.time), unit, issuedTime: iso(issued),
    validUntil: iso(series.at(-1).time), floodStage: thresholds.minor, thresholds, floodCategory,
    observed, observedTime: observed === null ? null : iso(observedTime), series };
}

// WSSI uses UTC strings such as "2026-11-02 0116Z" and "00Z 11/02/26".
function winterTime(value) {
  if (typeof value !== 'string') return NaN;
  const issue = value.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2})(\d{2})Z$/);
  const valid = value.match(/^(\d{2})Z (\d{2})\/(\d{2})\/(\d{2})$/);
  let parts;
  if (issue) parts = [+issue[1], +issue[2], +issue[3], +issue[4], +issue[5]];
  else if (valid) parts = [2000 + +valid[4], +valid[2], +valid[3], +valid[1], 0];
  else return NaN;
  const time = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4]);
  const date = new Date(time);
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes()]
    .every((part, index) => part === parts[index]) ? time : NaN;
}

export function parseWinterOutlook(response, now = Date.now()) {
  const base = { ...WINTER_SOURCE, status: 'unavailable', label: 'Outlook unavailable',
    summary: 'Winter impact coverage could not be confirmed. Check the NOAA outlook.' };
  if (!response || response.error || response.exceededTransferLimit || !Array.isArray(response.features)) return base;
  if (!response.features.length) return { ...base, label: 'No mapped impact',
    summary: 'No winter impact area returned for this location. This is not an all-clear; check NOAA coverage.' };
  const areas = response.features.flatMap(feature => {
    const a = feature?.attributes, rank = IMPACTS.indexOf(a?.impact);
    const issue = winterTime(a?.issue_time), start = winterTime(a?.start_time), end = winterTime(a?.end_time);
    if (rank < 0 || a?.component !== 'WSSI_OVERALL' || !Number.isFinite(issue) || !Number.isFinite(start) ||
        !Number.isFinite(end) || issue > now + 300000 || start >= end || start > now + 86400000) return [];
    return [{ impact: a.impact, rank, issue, start, end }];
  });
  // A malformed overlapping area could hide the highest category.
  if (areas.length !== response.features.length) return base;
  const current = areas.filter(area => area.end > now && now - area.issue <= 6 * 3600000);
  if (!current.length) return { ...base, status: 'stale', label: 'Stale winter outlook',
    summary: 'The returned winter outlook has expired or has not been updated recently.' };
  const area = current.reduce((best, candidate) => candidate.rank > best.rank ? candidate : best);
  const label = area.rank === 0 ? 'Winter weather area' : `${area.impact[0]}${area.impact.slice(1).toLowerCase()} impacts`;
  return { ...base, status: 'ready', label, impact: area.impact, rank: area.rank,
    summary: 'Potential winter impacts over days 1–3. Use with official NWS forecasts and warnings.',
    issuedTime: iso(area.issue), validFrom: iso(area.start), validUntil: iso(area.end) };
}

export async function riverCrest(gauge = settings().riverGauge, fetchJSON = getJSON, now = Date.now()) {
  gauge = typeof gauge === 'string' ? gauge.trim().toUpperCase() : '';
  const source = riverSource(gauge);
  if (!gauge) return { ...source, status: 'configure', label: 'Choose a river gauge',
    summary: 'Add a NOAA river gauge in Settings → Weather sources, sensors & camera.' };
  if (!/^[A-Z0-9]{3,8}$/.test(gauge)) return { ...source, status: 'configure', label: 'Check river gauge',
    summary: 'Enter a valid NOAA gauge identifier in Settings → Weather sources, sensors & camera.' };
  const url = `https://api.water.noaa.gov/nwps/v1/gauges/${gauge}`;
  try {
    const [metadata, flow] = await Promise.all([fetchJSON(url), fetchJSON(`${url}/stageflow`)]);
    return parseRiverCrest(metadata, flow, gauge, now);
  } catch {
    return { ...source, status: 'unavailable', label: 'River source unavailable',
      summary: 'NOAA river data could not be loaded. Open the source for current guidance.' };
  }
}

export async function winterOutlook(lat = coords().lat, lon = coords().lon, fetchJSON = getJSON, now = Date.now()) {
  lat = number(lat); lon = number(lon);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return {
    ...WINTER_SOURCE, status: 'configure', label: 'Set your location', summary: 'Choose a location to load the winter impact outlook.' };
  if (lat < 24 || lat > 50 || lon < -125 || lon > -66) return { ...WINTER_SOURCE,
    status: 'outside-coverage', label: 'Outside WSSI coverage', summary: 'This winter impact product covers the contiguous United States.' };
  const query = new URLSearchParams({ where: '1=1', geometry: `${lon},${lat}`, geometryType: 'esriGeometryPoint',
    inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'impact,component,issue_time,start_time,end_time',
    returnGeometry: 'false', f: 'json' });
  try {
    return parseWinterOutlook(await fetchJSON(`${WSSI_QUERY}?${query}`), now);
  } catch {
    return { ...WINTER_SOURCE, status: 'unavailable', label: 'Winter source unavailable',
      summary: 'NOAA winter data could not be loaded. Open the source for current guidance.' };
  }
}

export async function getBalancedContext({ lat = coords().lat, lon = coords().lon, riverGauge = settings().riverGauge } = {}) {
  const [river, winter] = await Promise.all([riverCrest(riverGauge), winterOutlook(lat, lon)]);
  return { river, winter };
}
