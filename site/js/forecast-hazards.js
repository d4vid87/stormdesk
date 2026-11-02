import { coords, everyVisible, num, U } from './app.js';
import { forecast, cacheContext } from './desk.js';
import * as api from './api.js';

const DAY = 86400000;
const WPC = 'https://mapservices.weather.noaa.gov/vector/rest/services/hazards/wpc_precip_hazards/MapServer';
const HEAT = 'https://mapservices.weather.noaa.gov/experimental/rest/services/NWS_HeatRisk/ImageServer';
const RAIN = ['Below 5% contour', 'Marginal · at least 5%', 'Slight · at least 15%', 'Moderate · at least 40%', 'High · at least 70%'];
const HEAT_LABEL = ['Little to no heat risk', 'Minor', 'Moderate', 'Major', 'Extreme'];
const HAZARDS = [['torn', 'Tornado'], ['hail', 'Large hail'], ['wind', 'Damaging thunderstorm wind']];
const node = (tag, className, text) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
};
const url = (base, params) => `${base}?${new URLSearchParams(params)}`;
const conusBounds = ({lat, lon}) => Number.isFinite(lat) && Number.isFinite(lon) && lat >= 24 && lat <= 50 && lon >= -125 && lon <= -66;
const contextKey = () => `${coords().lat},${coords().lon}:${cacheContext('forecast')}`;
const dateTime = t => new Date(t).toLocaleString([], {month:'short', day:'numeric', hour:'numeric', minute:'2-digit', timeZoneName:'short'});
const dayName = t => new Date(t).toLocaleDateString([], {timeZone:'UTC', weekday:'short', month:'short', day:'numeric'});

export function hazardTime(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : NaN;
  if (typeof value !== 'string' || !value.trim()) return NaN;
  if (/^\d{12}$/.test(value)) value = `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T${value.slice(8,10)}:${value.slice(10,12)}:00Z`;
  else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) value = value.replace(' ', 'T') + 'Z';
  return Date.parse(value);
}

// NOAA probability polygons can contain holes and overlapping intensity contours.
export function hazardContains(geometry, lat, lon) {
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : null;
  if (!Array.isArray(polygons) || !polygons.length) return null;
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !polygon.length || polygon.some(ring => !Array.isArray(ring) || ring.length < 4 || ring.some(p => !Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])))) return null;
  }
  return polygons.some(p => api.pointInRing(lon, lat, p[0]) && !p.slice(1).some(hole => api.pointInRing(lon, lat, hole)));
}

function period(properties, kind) {
  const p = properties || {};
  return kind === 'rain' ? {start:hazardTime(p.start_time), end:hazardTime(p.end_time), issued:hazardTime(p.issue_time)} :
    {start:hazardTime(p.VALID_ISO || p.VALID), end:hazardTime(p.EXPIRE_ISO || p.EXPIRE), issued:hazardTime(p.ISSUE_ISO || p.ISSUE)};
}

function fresh(p, now) {
  return Number.isFinite(p.start) && Number.isFinite(p.end) && Number.isFinite(p.issued) && p.start < p.end && p.end > now && p.end <= now + 8 * DAY && p.issued <= now + 3600000 && now - p.issued <= 2 * DAY;
}

export function polygonOutlook(data, kind, lat, lon, now = Date.now(), metadata = null) {
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) return {status:'unavailable'};
  const periods = data.features.map(f => period(f.properties, kind));
  if (!periods.length && metadata?.type === 'FeatureCollection') periods.push(...metadata.features.map(f => period(f.properties, kind)));
  const current = periods.filter(p => fresh(p, now)).sort((a,b) => b.issued - a.issued)[0];
  if (!current) return {status:periods.some(p => Number.isFinite(p.end) && p.end <= now) ? 'expired' : 'unavailable'};
  let risk = 0, cig = 0, significant = false;
  for (const feature of data.features) {
    const p = period(feature.properties, kind);
    if (p.issued !== current.issued || p.start !== current.start || p.end !== current.end) continue;
    const hit = hazardContains(feature.geometry, lat, lon);
    if (hit == null) return {status:'unavailable'};
    const prop = feature.properties || {};
    const intensity = kind !== 'rain' && /^CIG([1-3])$/.exec(prop.LABEL || '');
    if (intensity) { if (hit) cig = Math.max(cig, Number(intensity[1])); continue; }
    if (kind !== 'rain' && prop.LABEL === 'SIGN') { if (hit) significant = true; continue; }
    const value = kind === 'rain' ? prop.dn : Number(prop.LABEL) * 100;
    const allowed = kind === 'rain' ? [0,1,2,3,4] : kind === 'torn' ? [2,5,10,15,30,45,60] : kind === 'hail' ? [5,15,30,45,60] : [5,15,30,45,60,75,90];
    const rounded = Math.round(value);
    if (!Number.isFinite(value) || Math.abs(value - rounded) > 0.001 || !allowed.includes(rounded)) return {status:'unavailable'};
    if (hit) risk = Math.max(risk, rounded);
  }
  return {status:'available', ...current, risk, cig, significant};
}

export function heatOutlook(data, now = Date.now()) {
  if (!Array.isArray(data?.samples)) return [];
  const days = new Map();
  for (const sample of data.samples) {
    const a = sample.attributes || {}, start = hazardTime(a.idp_validtime), issued = hazardTime(a.idp_filedate);
    const risk = typeof sample.value === 'string' && sample.value.trim() ? Number(sample.value) : typeof sample.value === 'number' ? sample.value : NaN;
    const p = {start, end:start + DAY, issued};
    if (!fresh(p, now) || !Number.isInteger(risk) || risk < 0 || risk > 4) continue;
    const old = days.get(start);
    if (!old || old.issued < issued) days.set(start, {...p, risk, status:'available'});
  }
  return [...days.values()].sort((a,b) => a.start - b.start).slice(0,7);
}

// Sunset/sunrise boundaries avoid inventing a universal threshold for overnight heat relief.
export function overnightCooling(fc, now = Date.now() / 1000) {
  const days = fc?.forecast?.daily || [], hours = fc?.forecast?.hourly || [];
  for (let i = 0; i < days.length - 1; i++) {
    const start = days[i].sunset, end = days[i + 1].sunrise;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || end <= now) continue;
    const night = hours.filter(h => h.time >= start && h.time < end);
    if (!night.length || night[0].time > start + 3600 || night.at(-1).time < end - 3600 || night.some((h,j) => !Number.isFinite(h.air_temperature) || j > 0 && h.time - night[j-1].time > 3600)) return null;
    return {start, end, low:Math.min(...night.map(h => h.air_temperature)), high:Math.max(...night.map(h => h.air_temperature)), partial:now > start};
  }
  return null;
}

export function initForecastHazards(host) {
  if (!host || host.dataset.hazardsReady) return;
  host.dataset.hazardsReady = 'true';
  const intro = node('p', 'fd-note', 'Official outlooks · contiguous United States · outlooks are planning guidance, not warnings.');
  host.append(intro);
  const makeGroup = (title, href) => {
    const details = node('details'), summary = node('summary', '', title), tag = node('span', 'fd-tag', 'Loading');
    summary.append(tag); details.append(summary);
    const body = node('div', 'fd-hazard-list'); details.append(body);
    const source = node('a', 'fd-note', 'Official source ↗'); source.href = href; source.target = '_blank'; source.rel = 'noopener noreferrer';
    details.append(source); host.append(details); return {body, tag};
  };
  const rain = makeGroup('Flash-flood outlook', 'https://www.wpc.ncep.noaa.gov/qpf/excess_rain.shtml');
  const heat = makeGroup('HeatRisk · experimental', 'https://www.wpc.ncep.noaa.gov/heatrisk/');
  const severe = makeGroup('Tornado, hail & wind', 'https://www.spc.noaa.gov/products/outlook/');
  let generation = 0, activeContext = contextKey(), state = null, pendingContext = null;
  const row = (parent, label, reading, hint) => {
    const el = node('div', 'fd-context-item');
    el.append(node('span', 'fd-note', label), node('strong', '', reading));
    if (hint) el.append(node('small', 'fd-note', hint));
    parent.append(el);
  };
  const timing = p => `Valid ${dateTime(p.start)} – ${dateTime(p.end)} · issued ${dateTime(p.issued)}`;
  const unavailable = p => p?.status === 'expired' ? 'Expired outlook' : 'Unavailable';
  function render() {
    for (const group of [rain, heat, severe]) group.body.replaceChildren();
    if (!state || state.status) {
      const message = state?.status === 'outside' ? 'Available for locations in the contiguous United States.' : state?.status === 'coverage' ? 'Unable to verify US coverage. Official outlooks are unavailable for this location.' : 'Loading official outlooks…';
      for (const group of [rain, heat, severe]) { group.tag.textContent = state ? 'Unavailable' : 'Loading'; group.body.append(node('p', 'fd-note', message)); }
      return;
    }
    const expire = p => p.status === 'available' && !fresh(p, Date.now()) ? {...p, status:'expired'} : p;
    state.rain = state.rain.map(expire);
    state.severe.forEach(day => { day.hazards = day.hazards.map(expire); });
    state.heat = state.heat.filter(p => fresh(p, Date.now()));
    const rainValid = state.rain.filter(p => p.status === 'available');
    const rainPeak = Math.max(0, ...rainValid.map(p => p.risk));
    rain.tag.textContent = rainPeak ? RAIN[rainPeak] : rainValid.length === 3 ? 'Below 5% contour' : 'Incomplete';
    state.rain.forEach((p,i) => row(rain.body, `Day ${i+1}`, p.status === 'available' ? RAIN[p.risk] : unavailable(p), p.status === 'available' ? timing(p) : 'The current valid outlook could not be confirmed.'));
    rain.body.append(node('p', 'fd-note', 'WPC probability of rainfall exceeding flash-flood guidance within 25 miles. Below a contour does not mean zero flood risk.'));

    heat.tag.textContent = state.heat.length ? HEAT_LABEL[Math.max(...state.heat.map(p => p.risk))] : 'Unavailable';
    const heatGrid = node('div', 'fd-context-grid'); heat.body.append(heatGrid);
    if (!state.heat.length) heat.body.append(node('p', 'fd-note', 'No current HeatRisk samples are available for this location.'));
    for (const p of state.heat) row(heatGrid, dayName(p.start), `${p.risk} · ${HEAT_LABEL[p.risk]}`, `Valid ${dateTime(p.start)} – ${dateTime(p.end)} · updated ${dateTime(p.issued)}`);
    const night = overnightCooling(forecast());
    if (night) row(heat.body, 'Overnight cooling · forecast', `${num(night.low)}${U.temp()} minimum · ${num(night.high - night.low)}° temperature range`, `${dateTime(night.start * 1000)} – ${dateTime(night.end * 1000)}${night.partial ? ' · night already in progress' : ''}. Forecast temperatures, not a separate HeatRisk rating.`);
    else heat.body.append(node('p', 'fd-note', 'Overnight cooling unavailable: a complete sunset-to-sunrise temperature forecast is needed.'));
    heat.body.append(node('p', 'fd-note', 'HeatRisk includes daytime and nighttime heat, duration, and local seasonality. Missing days are unavailable, not zero risk.'));

    const known = state.severe.flatMap(d => d.hazards).filter(p => p.status === 'available');
    severe.tag.textContent = known.some(p => p.risk > 0) ? 'Elevated probabilities' : known.length === 6 ? 'Below mapped contours' : 'Incomplete';
    state.severe.forEach((day,i) => {
      const box = node('section'); box.append(node('h3', '', `Day ${i+1}`)); severe.body.append(box);
      day.hazards.forEach((p,j) => {
        const [kind, title] = HAZARDS[j];
        let reading = p.status === 'available' ? p.risk ? `${p.risk}%` : `Below ${kind === 'torn' ? 2 : 5}% contour` : unavailable(p);
        if (p.cig) reading += ` · CIG ${p.cig}`;
        if (p.significant) reading += ' · significant-severe area';
        row(box, title, reading, p.status === 'available' ? timing(p) : 'Current probability unavailable.');
      });
    });
    severe.body.append(node('p', 'fd-note', 'SPC probabilities apply within 25 miles during each valid period. Hail: at least 1 inch; thunderstorm wind: at least 58 mph. CIG indicates conditional intensity if a storm occurs, not its probability.'));
  }

  async function refresh() {
    const key = contextKey(), c = coords();
    if (pendingContext === key) return;
    const ticket = ++generation; pendingContext = key;
    const current = () => ticket === generation && key === contextKey();
    try {
      if (!conusBounds(c)) { if (current()) { state = {status:'outside'}; render(); } return; }
      // A bounding box alone would falsely label Canadian/Mexican locations below risk contours.
      const coverage = await api.nwsPoint(c.lat, c.lon).catch(() => null);
      if (!current()) return;
      if (!coverage?.properties?.cwa) { state = {status:'coverage'}; render(); return; }
      const settled = await Promise.all([
        Promise.all([0,1,2].map(async i => {
          const data = await api.getJSON(url(`${WPC}/${i}/query`, {where:'1=1', outFields:'dn,outlook,issue_time,start_time,end_time', returnGeometry:'true', outSR:'4326', f:'geojson'})).catch(() => null);
          return polygonOutlook(data, 'rain', c.lat, c.lon);
        })),
        api.getJSON(url(`${HEAT}/getSamples`, {geometry:JSON.stringify({x:c.lon,y:c.lat,spatialReference:{wkid:4326}}),geometryType:'esriGeometryPoint',returnFirstValueOnly:'false',outFields:'name,idp_validtime,idp_filedate',renderingRule:JSON.stringify({rasterFunction:'None'}),f:'json'})).then(j => heatOutlook(j)).catch(() => []),
        Promise.all([1,2].map(async day => {
          const [meta, ...data] = await Promise.all([api.spcOutlook(day).catch(() => null), ...HAZARDS.map(([kind]) => api.getJSON(`https://www.spc.noaa.gov/products/outlook/day${day}otlk_${kind}.lyr.geojson`).catch(() => null))]);
          return {hazards:data.map((j,i) => polygonOutlook(j, HAZARDS[i][0], c.lat, c.lon, Date.now(), meta))};
        })),
      ]);
      if (!current()) return;
      state = {rain:settled[0], heat:settled[1], severe:settled[2]}; render();
    } finally { if (ticket === generation) pendingContext = null; }
  }
  const schedule = () => everyVisible('forecast-hazards', 1800, host, refresh);
  window.addEventListener('wd:settings', () => {
    if (activeContext !== contextKey()) { activeContext = contextKey(); generation++; pendingContext = null; state = null; render(); schedule(); }
    else render();
  });
  window.addEventListener('wd:forecast', render);
  render(); schedule();
}
