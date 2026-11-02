import { settings, coords, milesBetween, num } from './app.js';
import { cacheContext } from './desk.js';
import * as api from './api.js';

// Soil moisture is volumetric water content, not percentage of field capacity.
export function soilSnapshot(j, metric = false, now = Date.now() / 1000) {
  const h = j?.hourly || {}, times = h.time || [];
  let i = -1;
  times.forEach((t, index) => { if (Number.isFinite(t) && t <= now && (i < 0 || t > times[i])) i = index; });
  const temperature = key => {
    const v = h[key]?.[i], unit = j?.hourly_units?.[key];
    if (!Number.isFinite(v) || !['°C', '°F'].includes(unit)) return null;
    return metric ? (unit === '°F' ? (v - 32) / 1.8 : v) : (unit === '°C' ? v * 1.8 + 32 : v);
  };
  const moisture = key => {
    const v = h[key]?.[i];
    return j?.hourly_units?.[key] === 'm³/m³' && Number.isFinite(v) && v >= 0 && v <= 1 ? v * 100 : null;
  };
  return {
    time: i < 0 ? null : times[i], stale: i < 0 || now - times[i] > 10800,
    temperature6: temperature('soil_temperature_6cm'), temperature18: temperature('soil_temperature_18cm'),
    moisture3to9: moisture('soil_moisture_3_to_9cm'), moisture9to27: moisture('soil_moisture_9_to_27cm'),
  };
}

export async function nearbyCeiling(lat, lon) {
  const point = await api.nwsPoint(lat, lon);
  const url = new URL(point?.properties?.observationStations || '');
  if (url.origin !== 'https://api.weather.gov' || !url.pathname.endsWith('/stations')) throw new Error('Observation stations unavailable');
  const list = await api.getJSON(url.href);
  const stations = (list.features || []).map(f => ({
    id: f.properties?.stationIdentifier, name: f.properties?.name,
    lat: f.geometry?.coordinates?.[1], lon: f.geometry?.coordinates?.[0],
  })).filter(s => /^[A-Z0-9]{3,6}$/.test(s.id || '') && Number.isFinite(s.lat) && Number.isFinite(s.lon))
    .map(s => ({ ...s, miles: milesBetween(lat, lon, s.lat, s.lon) }))
    .filter(s => s.miles <= 100).sort((a, b) => a.miles - b.miles).slice(0, 3);
  const reports = await Promise.allSettled(stations.map(async station => ({ station, report: await api.metarObs(station.id) })));
  const available = reports.filter(r => r.status === 'fulfilled' && r.value.report.obs?.[0]).map(r => r.value);
  // Prefer a recent usable report, then the nearest station; keep old reports explicitly labelled.
  const rank = r => {
    const o = r.report.obs[0];
    return (o.observation_valid && !o.stale ? 0 : 2)
      + (o.ceiling_status !== 'unavailable' || Number.isFinite(o.visibility) ? 0 : 1);
  };
  available.sort((a, b) => rank(a) - rank(b) || a.station.miles - b.station.miles);
  if (!available.length) throw new Error('No nearby observation reports');
  return available[0];
}

const node = (tag, cls, text) => {
  const el = document.createElement(tag); el.className = cls || '';
  if (text != null) el.textContent = text; return el;
};

export function initForecastEnvironment(hostElement) {
  if (!hostElement || document.getElementById('forecast-environment-details')) return;
  const panel = node('details'); panel.id = 'forecast-environment-details';
  panel.append(node('summary', '', 'Soil & nearby cloud ceiling'));
  const body = node('div'), status = node('p', 'fd-note'), soilBody = node('div'), ceilingBody = node('div');
  status.setAttribute('aria-live', 'polite');
  const refresh = node('button', '', 'Refresh soil & ceiling'); refresh.type = 'button';
  body.append(status, soilBody, ceilingBody, refresh); panel.append(body); hostElement.append(panel);
  let context = cacheContext('forecast'), generation = 0, pending = false, loadedAt = 0, soil = null, ceiling = null;
  let soilError = false, ceilingError = false;
  const item = (label, value, hint) => {
    const el = node('div', 'fd-context-item');
    el.append(node('span', 'fd-note', label), node('strong', '', value));
    if (hint) el.append(node('small', 'fd-note', hint)); return el;
  };
  const stamp = t => Number.isFinite(t) ? new Date(t * 1000).toLocaleString([], {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'}) : 'Time unavailable';
  function render() {
    const metric = settings().units === 'metric', unit = metric ? '°C' : '°F';
    soilBody.replaceChildren(node('h3', '', 'Soil conditions'));
    if (soil) {
      const s = soilSnapshot(soil, metric), grid = node('div', 'fd-context-grid');
      grid.append(item('Temperature · 6 cm depth', `${num(s.temperature6, 1)} ${unit}`),
        item('Temperature · 18 cm depth', `${num(s.temperature18, 1)} ${unit}`),
        item('Moisture · 3–9 cm depth', `${num(s.moisture3to9, 1)}%`, 'Volumetric water content'),
        item('Moisture · 9–27 cm depth', `${num(s.moisture9to27, 1)}%`, 'Volumetric water content'));
      soilBody.append(grid, node('p', 'fd-note', `Open-Meteo model estimate · ${stamp(s.time)} · device local time${s.stale ? ' · Outdated model hour' : ''}${soilError ? ' · Refresh failed; showing previous model data' : ''}`));
    } else soilBody.append(node('p', 'fd-note', soilError ? 'Soil model data unavailable. Try Refresh.' : 'Open this panel to load soil model estimates.'));
    ceilingBody.replaceChildren(node('h3', '', 'Nearby observed cloud ceiling'));
    if (ceiling) {
      const o = ceiling.report.obs[0], station = ceiling.station, valid = o.observation_valid;
      const old = !valid || Date.now() / 1000 - o.timestamp > 7200;
      const height = n => `${num(n * (metric ? 1 : 3.28084))} ${metric ? 'm' : 'ft'} above ground`;
      const value = !valid ? 'Unavailable' : o.ceiling_status === 'measured' ? height(o.ceiling)
        : o.ceiling_status === 'clear' ? 'Reported clear' : o.ceiling_status === 'no-ceiling' ? 'No ceiling reported' : 'Unavailable';
      const grid = node('div', 'fd-context-grid');
      grid.append(item('Observed ceiling', value, o.ceiling_status === 'clear' ? 'Within observation detection limits' : 'Lowest broken / overcast layer or vertical visibility'),
        item('Observed visibility', valid && Number.isFinite(o.visibility) ? `${num(o.visibility / (metric ? 1000 : 1609.344), 1)} ${metric ? 'km' : 'mi'}` : 'Unavailable'));
      ceilingBody.append(grid, node('p', 'fd-note', `${station.id} · ${station.name || ceiling.report.station_name || 'Nearby station'} · ${num(station.miles * (metric ? 1.609344 : 1), 1)} ${metric ? 'km' : 'mi'} away`),
        node('p', 'fd-note', `NWS observation · ${stamp(o.timestamp)} · device local time${old ? ' · Outdated or invalid observation' : ''}${ceilingError ? ' · Refresh failed; showing previous report' : ''}`),
        node('p', 'fd-note', 'Conditions at the reporting station may differ from your location.'));
    } else ceilingBody.append(node('p', 'fd-note', ceilingError ? 'Nearby observations unavailable for this location. NWS station coverage is primarily the United States.' : 'Open this panel to find nearby reporting stations.'));
  }
  async function load(force = false) {
    if (!panel.open || document.hidden || !body.getClientRects().length || pending) return;
    if (!force && loadedAt && Date.now() - loadedAt < 900000) { render(); return; }
    const c = coords(), units = settings().units;
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) { status.textContent = 'Select a weather location to load this panel.'; return; }
    const request = ++generation, requestContext = context;
    pending = true; refresh.disabled = true; status.textContent = 'Loading soil and nearby observations…';
    const results = await Promise.allSettled([api.soilForecast(c.lat, c.lon, units), nearbyCeiling(c.lat, c.lon)]);
    if (request !== generation || requestContext !== cacheContext('forecast')) return;
    [soilError, ceilingError] = results.map(r => r.status === 'rejected');
    if (!soilError) soil = results[0].value;
    if (!ceilingError) ceiling = results[1].value;
    loadedAt = Date.now(); pending = false; refresh.disabled = false;
    status.textContent = soilError || ceilingError ? 'Some data could not be refreshed.' : 'Model soil conditions and nearby observations are labelled separately.';
    render();
  }
  refresh.onclick = () => load(true);
  panel.addEventListener('toggle', () => { if (panel.open) load(); });
  window.addEventListener('wd:forecast', () => load());
  window.addEventListener('wd:section', () => load());
  window.addEventListener('wd:settings', () => {
    const next = cacheContext('forecast');
    if (next === context) { load(); return; }
    context = next; generation++; pending = false; loadedAt = 0; soil = ceiling = null; soilError = ceilingError = false;
    refresh.disabled = false; status.textContent = ''; render(); load();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  render();
}
