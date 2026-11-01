import { getJSON } from './api.js';

// Source contracts: Open-Meteo air-quality docs, ECCC weather-alerts queryables,
// NOAA NWPS v1, and PurpleAir local JSON firmware 7.04 documentation.
export const POLLEN_SPECIES = ['alder', 'birch', 'grass', 'mugwort', 'olive', 'ragweed'];
const finite = value => value !== null && value !== '' && value !== undefined && typeof value !== 'boolean' && Number.isFinite(Number(value)) ? Number(value) : null;
const stamp = value => typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
const reading = value => { const n = finite(value); return n === -999 || n === -9999 ? null : n; };
const positive = value => { const n = finite(value); return n !== null && n >= 0 ? n : null; };
function coordinates(lat, lon) {
  lat = finite(lat); lon = finite(lon);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('Invalid location');
  return [lat, lon];
}

export async function pollen(lat, lon, fetchJSON = getJSON, now = Date.now()) {
  [lat, lon] = coordinates(lat, lon);
  const result = { source: 'CAMS via Open-Meteo', available: false, reason: '', units: 'grains/m³', series: {}, start: null, end: null };
  // CAMS pollen is regional. A global model's zero placeholders are not a low-pollen forecast.
  if (lat < 30 || lat > 72 || lon < -25 || lon > 45) return { ...result, reason: 'Pollen forecasts are available only in Europe during pollen season.' };
  const query = new URLSearchParams({ latitude: lat, longitude: lon, hourly: POLLEN_SPECIES.map(s => `${s}_pollen`).join(','), forecast_days: 4, timeformat: 'unixtime' });
  const j = await fetchJSON(`https://air-quality-api.open-meteo.com/v1/air-quality?${query}`);
  const times = j?.hourly?.time;
  if (!Array.isArray(times) || times.length > 200 || times.some((t, i) => finite(t) === null || (i && +t <= +times[i - 1]))) throw new Error('Invalid pollen forecast');
  for (const species of POLLEN_SPECIES) {
    const values = j.hourly[`${species}_pollen`];
    if (!Array.isArray(values) || values.length !== times.length) continue;
    result.series[species] = times.flatMap((t, i) => {
      const value = positive(values[i]), time = +t * 1000;
      return value !== null && time >= now - 3600000 && time <= now + 4 * 86400000 ? [{ time, value }] : [];
    });
  }
  const available = Object.values(result.series).flat();
  result.available = available.some(p => p.time >= now);
  if (result.available) {
    result.start = Math.min(...available.map(p => p.time)); result.end = Math.max(...available.map(p => p.time));
  } else result.reason = 'No current pollen forecast is available for this location and season.';
  return result;
}

export async function river(gauge, fetchJSON = getJSON, now = Date.now()) {
  if (typeof gauge !== 'string' || !/^[A-Za-z0-9]{3,12}$/.test(gauge)) throw new Error('Enter a valid NOAA river gauge identifier');
  gauge = gauge.toUpperCase();
  const url = `https://api.water.noaa.gov/nwps/v1/gauges/${gauge}`;
  const [j, flow] = await Promise.all([fetchJSON(url), fetchJSON(`${url}/stageflow`)]);
  if (!j || typeof j.name !== 'string' || String(j.lid).toUpperCase() !== gauge) throw new Error('River gauge unavailable');
  const obs = j.status?.observed, time = stamp(obs?.validTime);
  const valid = Number.isFinite(time) && time <= now + 300000;
  const unit = typeof obs?.primaryUnit === 'string' ? obs.primaryUnit : null;
  const level = valid && unit ? reading(obs?.primary) : null;
  const history = flow?.observed?.primaryUnits === unit && Array.isArray(flow.observed.data) ? flow.observed.data.flatMap(p => {
    const t = stamp(p.validTime), value = reading(p.primary);
    return value !== null && Number.isFinite(t) && t <= now && t >= now - 7 * 86400000 ? [{ time: t, value }] : [];
  }).sort((a, b) => a.time - b.time) : [];
  const thresholds = {};
  for (const name of ['action', 'minor', 'moderate', 'major']) thresholds[name] = j.flood?.stageUnits === unit ? reading(j.flood.categories?.[name]?.stage) : null;
  return { gauge, name: j.name, source: 'NOAA National Water Prediction Service', level, unit,
    validTime: valid ? new Date(time).toISOString() : null, stale: !valid || now - time > 2 * 3600000,
    thresholds, history, floodCategory: typeof obs?.floodCategory === 'string' ? obs.floodCategory : null };
}

function inRing(lon, lat, ring) {
  if (!Array.isArray(ring) || ring.length < 4 || ring.some(p => !Array.isArray(p) || p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, y] = ring[i], [xx, yy] = ring[j];
    if (Math.abs((lon - x) * (yy - y) - (lat - y) * (xx - x)) < 1e-10 && lon >= Math.min(x, xx) && lon <= Math.max(x, xx) && lat >= Math.min(y, yy) && lat <= Math.max(y, yy)) return true;
    if ((y > lat) !== (yy > lat) && lon < (xx - x) * (lat - y) / (yy - y) + x) inside = !inside;
  }
  return inside;
}
function contains(geometry, lon, lat) {
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  return Array.isArray(polygons) && polygons.some(p => Array.isArray(p) && inRing(lon, lat, p[0]) && !p.slice(1).some(r => inRing(lon, lat, r)));
}

export async function canadaAlerts(lat, lon, fetchJSON = getJSON, now = Date.now()) {
  [lat, lon] = coordinates(lat, lon);
  const base = 'https://api.weather.gc.ca/collections/weather-alerts/items';
  const query = new URLSearchParams({ f: 'json', bbox: [Math.max(-180, lon - .001), Math.max(-90, lat - .001), Math.min(180, lon + .001), Math.min(90, lat + .001)].join(','), limit: 100 });
  let next = `${base}?${query}`;
  const features = [], seen = new Set();
  for (let page = 0; next && page < 10; page++) {
    const j = await fetchJSON(next);
    if (!Array.isArray(j?.features)) throw new Error('Canadian warning service unavailable');
    for (const feature of j.features) {
      const p = feature.properties, expires = stamp(p?.expiration_datetime);
      if (!p || !Number.isFinite(expires) || expires <= now || /ended|cancelled|canceled/i.test(p.status_en || '') || !contains(feature.geometry, lon, lat)) continue;
      const event = p.alert_name_en, description = p.alert_text_en;
      if (typeof event !== 'string' || typeof description !== 'string') continue;
      const key = `${event}|${p.publication_datetime}|${description}`;
      if (seen.has(key)) continue;
      seen.add(key);
      features.push({ type: 'Feature', id: `eccc:${p.id || feature.id || key}`, geometry: feature.geometry, properties: {
        event, headline: `${event}${p.feature_name_en ? ` — ${p.feature_name_en}` : ''}`, description, instruction: '',
        // ECCC risk colours are not the NWS CAP severity scale; retain both without inventing equivalence.
        severity: 'Unknown', urgency: 'Unknown', certainty: 'Unknown', alertType: p.alert_type || '', riskColour: p.risk_colour_en || '',
        effective: Number.isFinite(stamp(p.validity_datetime)) ? p.validity_datetime : p.publication_datetime || null,
        sent: p.publication_datetime || null, expires: new Date(expires).toISOString(), ends: p.event_end_datetime || null,
        areaDesc: p.feature_name_en || '', senderName: 'Environment and Climate Change Canada', status: 'Actual', messageType: 'Alert',
      } });
    }
    const link = Array.isArray(j.links) ? j.links.find(l => l.rel === 'next')?.href : null;
    next = null;
    if (link) {
      const target = new URL(link, base);
      if (target.origin !== 'https://api.weather.gc.ca' || target.pathname !== '/collections/weather-alerts/items') throw new Error('Invalid Canadian warning pagination');
      next = target.href;
    }
  }
  if (next) throw new Error('Canadian warning response incomplete');
  return { type: 'FeatureCollection', features, source: 'Environment and Climate Change Canada' };
}

export function normalizeLocalAir(j, now = Date.now()) {
  const time = stamp(typeof j?.DateTime === 'string' ? j.DateTime.replaceAll('/', '-').replace(/z$/, 'Z') : '');
  const pm25A = positive(j?.pm2_5_atm), pm25B = positive(j?.pm2_5_atm_b);
  const values = [pm25A, pm25B].filter(v => v !== null);
  const valid = Number.isFinite(time) && time <= now + 300000;
  const stale = !valid || now - time > 600000;
  return { source: 'Local PurpleAir · uncorrected ATM', available: valid && !stale && values.length > 0,
    observedAt: valid ? new Date(time).toISOString() : null, stale, pm25A, pm25B,
    pm25: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
    unit: 'µg/m³', aqi: null, aqiLabel: 'Two-minute concentration; not a daily AQI' };
}

export async function localAir(fetchJSON = getJSON, now = Date.now()) {
  return normalizeLocalAir(await fetchJSON('/environment/air'), now);
}
