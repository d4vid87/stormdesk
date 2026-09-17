import { settings, saveSettings, coords, U, msToWind, deg2compass, num, timeStr, dayStr, expires } from '../js/app.js';
import * as api from '../js/api.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const SRV = window.__WD_SRV || '';
let latest = null;
let baseForecast = null;
let observation = null;
let observationError = '';
let forecastError = false;
let observationKey = '';
const stationKey = () => JSON.stringify([settings().stationId, settings().stationSource, settings().units, settings().windUnit]);
const configured = () => !!(settings().stationSource || (settings().token && settings().stationId));
function browsePlace(lat, lon, name) {
  saveSettings({ places: [...(settings().places || []).filter(p => p.id !== 'lite-browse'), { id: 'lite-browse', lat, lon, name }], activePlace: 'lite-browse' });
  baseForecast = null;
}

let sites = [];
let radarLoaded = false;
let stationStep = 0;
let stationBrand = 'tempest';
let stationResult = '';
let publicViewer = false;

const icon = (name = '') => {
  const sun = '<circle cx="40" cy="40" r="17" fill="currentColor" opacity=".2"/><circle cx="40" cy="40" r="12" fill="currentColor"/><path d="M40 9v8m0 46v8M9 40h8m46 0h8M18 18l6 6m32 32 6 6M18 62l6-6m32-32 6-6"/>';
  const cloud = '<path d="M20 51a12 12 0 0 1 0-24 18 18 0 0 1 34-3 14 14 0 1 1 5 27Z" fill="currentColor" fill-opacity=".15"/>';
  let shape = /cloud|rain|snow|sleet|thunder|fog/.test(name) ? cloud : /night/.test(name) ? '<path d="M53 12a28 28 0 1 0 15 43A27 27 0 0 1 53 12Z" fill="currentColor" fill-opacity=".2"/>' : sun;
  if (/rain|sleet/.test(name)) shape += '<path d="m25 59-4 9m20-9-4 9m20-9-4 9"/>';
  if (/snow/.test(name)) shape += '<path d="M25 60v10m-5-5h10m20-5v10m-5-5h10"/>';
  if (/thunder/.test(name)) shape += '<path d="m42 51-10 12h12l-9 12"/>';
  if (/fog/.test(name)) shape += '<path d="M16 61h48M22 69h36"/>';
  return `<svg class="weather-svg" viewBox="0 0 80 80" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${shape}</svg>`;
};
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

const age = (at) => {
  if (!at) return 'update time unavailable';
  const minutes = Math.max(0, Math.round((Date.now() / 1000 - at) / 60));
  return minutes < 1 ? 'updated just now' : `updated ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
};

const authHeaders = () => {
  const token = localStorage.getItem('wd.editorToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

async function hostJSON(path, options = {}) {
  const response = await fetch(`${SRV}${path}`, {
    signal: expires(5000),
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });
  if (!response.ok) throw new Error(String(response.status));
  if (!response.headers.get('content-type')?.includes('json')) throw new Error('not a StormDesk server');
  return response.json();
}

async function loadHost() {
  try {
    const body = await hostJSON('/config');
    if (body.settings) saveSettings(body.settings);
  } catch (error) {
    if (error.message !== '401') return;
    try {
      const body = await hostJSON('/config-public');
      if (body.settings) saveSettings(body.settings);
      publicViewer = true;
    } catch { /* static forecast-only host */ }
  }
}

async function saveHost(patch) {
  saveSettings(patch);
  if (publicViewer) throw new Error('This is a read-only dashboard. Pair this device from full StormDesk before changing the station.');
  try {
    const current = await hostJSON('/config');
    await hostJSON('/config', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _rev: current._rev || 0, settings: { ...(current.settings || {}), ...patch } }),
    });
  } catch (error) {
    if (error.message === 'not a StormDesk server') return;
    if (error.message === '404') return;
    throw error;
  }
}

function overlaySnapshot(forecast, snapshot) {
  const current = snapshot?.current;
  if (!current?.at) return forecast;
  const metric = settings().units === 'metric';
  const temperature = (v) => v == null ? null : metric ? v : v * 9 / 5 + 32;
  const rain = (v) => v == null ? null : metric ? v : v / 25.4;
  Object.assign(forecast.current_conditions, {
    time: current.at,
    air_temperature: temperature(current.temp),
    feels_like: temperature(current.feels_like),
    relative_humidity: current.humidity,
    wind_avg: msToWind(current.wind_avg),
    wind_gust: msToWind(current.wind_gust),
    wind_direction: current.wind_direction,
    precip_accum_local_day: rain(current.rain_day),
    uv: current.uv,
  });
  forecast._station = snapshot.station;
  return forecast;
}

async function snapshot() {
  try {
    const body = await hostJSON('/api/v1');
    return body.api === 1 ? body : null;
  } catch { return null; }
}

function render(forecast) {
  latest = forecast;
  const c = forecast.current_conditions || {};
  const days = forecast.forecast?.daily || [];
  const hours = (forecast.forecast?.hourly || []).filter((h) => h.time >= Date.now() / 1000 - 1800).slice(0, 12);
  const today = days[0] || {};
  const temp = num(c.air_temperature);
  $('.temperature span').textContent = temp;
  $('.temperature sup').textContent = settings().units === 'metric' ? '°C' : '°F';
  $('.weather-icon').innerHTML = icon(c.icon);
  $('#placeTitle').textContent = coords().name || 'Your weather';
  $('.condition-copy').firstChild.textContent = c.conditions || 'Conditions unavailable';
  $('.condition-copy small').textContent = `Feels like ${num(c.feels_like)}°`;
  $('.condition-copy').parentElement.nextElementSibling.innerHTML = `Forecast high <strong>${num(today.air_temp_high)}°</strong> · Low <strong>${num(today.air_temp_low)}°</strong> · ${num(today.precip_probability)}% chance of rain`;
  $('#windValue').innerHTML = c.wind_avg == null ? 'Unavailable' : `${deg2compass(c.wind_direction)} ${num(c.wind_avg)} ${U.wind()}<small>Gusts ${num(c.wind_gust)} ${U.wind()}</small>`;
  $('.stat:nth-child(2) strong').textContent = c.relative_humidity == null ? 'Unavailable' : `${num(c.relative_humidity)}%`;
  $('#rainValue').textContent = c.precip_accum_local_day == null ? 'Unavailable' : `${num(c.precip_accum_local_day, 2)} ${U.precip()}`;
  $('.stat:nth-child(4) strong').textContent = today.precip_probability == null ? 'Unavailable' : `${num(today.precip_probability)}%`;
  const state = observationError ? 'Offline' : observation ? (Date.now() / 1000 - observation.time > 300 ? 'Delayed' : 'Live') : configured() ? 'Waiting for reading' : 'Forecast-only';
  $('#readingBadge').textContent = forecast._station ? state : 'Forecast';
  $('#readingBadge').dataset.state = forecast._station ? state : 'Forecast';
  $('#todayTitle').textContent = forecast._station?.name || 'Local forecast';
  const source = forecast._station?.name || (settings().activePlace || !settings().token || settings().stationSource ? 'Open-Meteo forecast' : 'Tempest forecast');
  $('#sourceLine').textContent = `${source} · ${forecast._station ? state + ' · ' : ''}${age(c.time)}${forecastError ? ' · Forecast update unavailable' : ''}`;
  $('#todayHourly').innerHTML = hours.slice(0, 6).map((h, i) => `<div class="hour"><span>${i ? timeStr(h.time) : 'Now'}</span><i aria-hidden="true">${icon(h.icon)}</i><b>${num(h.air_temperature)}°</b><span>${h.precip_probability == null ? 'Rain —' : `${num(h.precip_probability)}% rain`}</span></div>`).join('');
  $('#fiveDay').innerHTML = days.slice(0, 5).map((d, i) => `<div class="day card"><span>${i ? dayStr(d.day_start_local) : 'Today'}</span><i aria-hidden="true">${icon(d.icon)}</i><b>${num(d.air_temp_high)}° <span class="low">${num(d.air_temp_low)}°</span></b><span>${d.precip_probability == null ? 'Rain —' : `${num(d.precip_probability)}% rain`}</span></div>`).join('');
  renderForecast($('#forecastList').dataset.mode || 'hourly');
  const connected = configured() || !!observation;
  $('#connectTitle').textContent = connected ? settings().stationName || 'Personal weather station' : 'Have a weather station?';
  $('#connectCopy').textContent = connected ? `${state} · ${age(observation?.time)}${observationError ? ' · ' + observationError : ''}` : 'Connect it to see readings from your own backyard.';
  $('#connectButton').textContent = connected ? 'Manage station' : 'Connect station';
  $('#stationStatus').textContent = state;
  $('#returnStation').hidden = !settings().activePlace || !connected;

}

function renderForecast(mode) {
  if (!latest) return;
  $('#forecastList').dataset.mode = mode;
  const rows = mode === 'hourly'
    ? (latest.forecast?.hourly || []).filter((h) => h.time >= Date.now() / 1000 - 1800).slice(0, 24)
    : (latest.forecast?.daily || []).slice(0, 10);
  $('#forecastList').innerHTML = rows.map((row) => mode === 'hourly'
    ? `<div class="forecast-row"><strong>${timeStr(row.time)}</strong><span>${icon(row.icon)}</span><span class="muted">${esc(row.conditions)}</span><span>${row.precip_probability == null ? '—' : `${num(row.precip_probability)}%`}</span><strong>${num(row.air_temperature)}°</strong></div>`
    : `<div class="forecast-row"><strong>${dayStr(row.day_start_local)}</strong><span>${icon(row.icon)}</span><span class="muted">${esc(row.conditions)}</span><span>${num(row.air_temp_low)}°</span><strong>${num(row.air_temp_high)}°</strong></div>`).join('');
}

function renderWeather() {
  const forecast = structuredClone(baseForecast || { current_conditions: {}, forecast: { hourly: [], daily: [] } });
  if (observation && !settings().activePlace) {
    forecast.current_conditions = { ...forecast.current_conditions, ...observation };
    forecast._station = { name: settings().stationName || 'Personal weather station' };
  }
  render(forecast);
}

async function refreshObservation() {
  const key = stationKey();
  if (key !== observationKey) {
    observation = null; observationKey = key;
    try { const saved = JSON.parse(localStorage.getItem('wd.liteObservation')); if (saved?.key === key) { observation = saved.reading; observationError = 'Checking station'; } } catch {}
  }
  if (!configured()) { renderWeather(); return; }
  try {
    let reading;
    if (!settings().stationSource && settings().token) {
      const body = await api.stationObs();
      if (body.status?.status_code) throw new Error('Station access rejected. Check credentials.');
      const o = body.obs?.[0];
      if (o?.timestamp) reading = Object.fromEntries(['air_temperature', 'feels_like', 'relative_humidity', 'wind_avg', 'wind_gust', 'wind_direction', 'precip_accum_local_day', 'uv'].map(k => [k, o[k] ?? null]));
      if (reading) reading.time = o.timestamp;
    } else {
      const body = await snapshot();
      if (!body) throw new Error('StormDesk host unavailable');
      if (body.current?.at) reading = overlaySnapshot({ current_conditions: {} }, body).current_conditions;
    }
    if (key !== stationKey()) return;
    observationError = '';
    if (reading) { observation = reading; try { localStorage.setItem('wd.liteObservation', JSON.stringify({ key, reading })); } catch {} }
  } catch (error) {
    if (key !== stationKey()) return;
    observationError = /401|403|rejected/i.test(error.message) ? 'Check station credentials' : 'Station update unavailable';
  }
  renderWeather();
}

async function refreshForecast() {
  if (coords().lat == null) { openDialog('locationDialog'); return; }
  const key = JSON.stringify([coords(), settings().units]);
  if (!baseForecast) { try { const saved = JSON.parse(localStorage.getItem('wd.liteForecast')); if (saved?.key === key) baseForecast = saved.forecast; } catch {} }
  try {
    const forecast = await api.betterForecast();
    if (key !== JSON.stringify([coords(), settings().units])) return;
    baseForecast = forecast;
    try { localStorage.setItem('wd.liteForecast', JSON.stringify({ key, forecast })); } catch {}
    forecastError = false;
  } catch { forecastError = true; }
  renderWeather();
  refreshAlerts();
}
async function refresh() {
  await Promise.allSettled([refreshForecast(), refreshObservation()]);
}

async function refreshAlerts() {
  try {
    const body = await api.alerts();
    const active = (body.features || []).filter((f) => !f.properties?.expires || Date.parse(f.properties.expires) > Date.now());
    const warning = active.sort((a, b) => ['Unknown', 'Minor', 'Moderate', 'Severe', 'Extreme'].indexOf(b.properties.severity) - ['Unknown', 'Minor', 'Moderate', 'Severe', 'Extreme'].indexOf(a.properties.severity))[0];
    $('#warningBanner').hidden = !warning;
    if (!warning) return;
    const p = warning.properties;
    $('#warningBanner strong').textContent = p.event;
    $('#warningBanner p').textContent = `${p.areaDesc || ''} · until ${new Date(p.ends || p.expires).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    $('#warningDialog .dialog-head h2').textContent = p.event;
    $('#warningDialog .dialog-body').innerHTML = `<div class="eyebrow">Official warning</div><p><strong>${esc(p.headline || p.areaDesc || '')}</strong></p><p>${esc(p.description || '')}</p><div class="notice">Source: National Weather Service · ${age(Date.parse(p.sent) / 1000)}</div><div class="dialog-actions"><button class="button primary" type="button" data-close>Done</button></div>`;
  } catch { $('#warningBanner').hidden = true; }
}

function showPage(name) {
  $$('.page').forEach((page) => { page.hidden = page.id !== `${name}Page`; });
  $$('nav [data-page]').forEach((button) => button.setAttribute('aria-current', button.dataset.page === name ? 'page' : 'false'));
  if (name === 'radar') loadRadarStill();
  if (name !== 'radar') stopRadar();
  scrollTo(0, 0);
}

const nearestSite = () => {
  const point = coords();
  if (point.lat == null || !sites.length) return '';
  return sites.filter((site) => !site.id.startsWith('T')).reduce((best, site) => {
    const distance = (site.lat - point.lat) ** 2 + (site.lon - point.lon) ** 2;
    return distance < best.distance ? { site, distance } : best;
  }, { site: null, distance: Infinity }).site?.id || '';
};

function loadRadarStill() {
  if (radarLoaded || coords().lat == null) return;
  radarLoaded = true;
  const site = nearestSite();
  if (!site) return;
  $('#radarStill').onerror = () => {
    $('#radarStill').hidden = true;
    $('.radar-label').textContent = 'Radar snapshot unavailable · press Play for live radar';
  };
  $('#radarStill').onload = () => { $('#radarStill').hidden = false; };
  $('#radarStill').src = `https://img.hookecho.io/snapshot.png?${new URLSearchParams({ site, size: '768', zoom: '6.5', basemap: 'dark', t: Math.floor(Date.now() / 300000) })}`;
  $('.radar-label').textContent = `Latest radar · ${site}`;
}

function playRadar() {
  const frame = $('#radarViewer');
  if (!frame.src) {
    const point = coords();
    frame.src = `https://hookecho.pages.dev/?embed#goto=${nearestSite()},${point.lon || ''},${point.lat || ''},6.5,bm:dark`;
  }
  frame.hidden = false;
  $('#radarStill').hidden = true;
  $('#radarPlay').textContent = 'Ⅱ';
  $('#radarPlay').setAttribute('aria-label', 'Pause live radar');
}

function stopRadar() {
  const frame = $('#radarViewer');
  frame.removeAttribute('src');
  frame.hidden = true;
  $('#radarStill').hidden = !$('#radarStill').naturalWidth;
  $('#radarPlay').textContent = '▶';
  $('#radarPlay').setAttribute('aria-label', 'Play live radar');
}

function openDialog(id) { const dialog = document.getElementById(id); if (!dialog.open) dialog.showModal(); }

function stationUI() {
  $$('#stationDialog .stepper i').forEach((part, i) => part.classList.toggle('done', i <= stationStep));
  const choices = `<div class="brand-options"><button class="button brand-option" data-brand="tempest"><strong>Tempest</strong><small>Cloud connection</small></button><button class="button brand-option" data-brand="ecowitt"><strong>Ecowitt / Wittboy</strong><small>Local upload</small></button><button class="button brand-option" data-brand="other"><strong>Other supported stations</strong><small>Ambient, Davis, WeeWX, AcuRite, La Crosse</small></button></div>`;
  if (stationStep === 0) $('#stationStep').innerHTML = publicViewer
    ? `<div class="eyebrow">Pair this device</div><h3>Editing is protected</h3><p>On the StormDesk host, open Settings → Access and start pairing. Enter the six-digit code here.</p><div class="field"><label for="pairCode">Pairing code</label><input id="pairCode" inputmode="numeric" maxlength="6"></div><div class="field"><label for="pairName">Device name</label><input id="pairName" value="Stormdesk Lite"></div><div class="notice error" id="pairError"></div><div class="dialog-actions"><button class="button primary" data-pair>Pair device</button></div>`
    : `<div class="eyebrow">Step 1 of 4</div><h3>Choose your station</h3><p>Cloud stations connect directly. Local-upload stations need this page served by a running StormDesk host.</p>${choices}`;
  if (stationStep === 1 && stationBrand === 'tempest') $('#stationStep').innerHTML = `<div class="eyebrow">Step 2 of 4 · Tempest</div><h3>Connect your account</h3><div class="field"><label for="stationToken">Personal access token</label><input id="stationToken" type="password" autocomplete="off"><p class="hint">Stored on your StormDesk host when available.</p></div><div class="field"><label for="stationId">Station ID</label><input id="stationId" inputmode="numeric"></div><div class="dialog-actions"><button class="button" data-back>Back</button><button class="button primary" data-check>Check connection</button></div>`;
  if (stationStep === 1 && stationBrand === 'ecowitt') $('#stationStep').innerHTML = `<div class="eyebrow">Step 2 of 4 · Ecowitt</div><h3>Point your gateway at StormDesk</h3><div class="notice"><strong>Always-on host required</strong><br>In WSView Plus choose Customized → Ecowitt and enter this address.</div><div class="field"><label for="ingestAddress">Upload address</label><input id="ingestAddress" readonly value="${location.origin}/ingest"></div><div class="dialog-actions"><button class="button" data-back>Back</button><button class="button primary" data-check>Check host</button></div>`;
  if (stationStep === 1 && stationBrand === 'other') $('#stationStep').innerHTML = `<div class="eyebrow">Supported connections</div><h3>Use the full setup for this station</h3><p>Ambient Weather, Weather Underground protocol, WeeWX, Davis WeatherLink Live, Ambient Weather Network, AcuRite through rtl_433, and La Crosse keep their existing tested StormDesk setup.</p><div class="dialog-actions"><button class="button" data-back>Back</button><a class="button primary" href="../">Open full setup</a></div>`;
  if (stationStep === 2) $('#stationStep').innerHTML = `<div class="eyebrow">Step 3 of 4</div><h3>${stationResult === 'success' ? 'Connection verified' : 'Connection needs attention'}</h3><div class="notice ${stationResult === 'success' ? 'success' : 'error'}">${stationResult === 'success' ? 'StormDesk can reach the station source.' : esc(stationResult)}</div><div class="dialog-actions"><button class="button" data-back>Back</button>${stationResult === 'success' ? '<button class="button primary" data-next>Wait for reading</button>' : ''}</div>`;
  if (stationStep === 3) $('#stationStep').innerHTML = `<div class="eyebrow">Step 4 of 4</div><h3>${observation ? "Reading received" : observationError ? "Station needs attention" : "Waiting for the first reading"}</h3><p>${observation ? esc(age(observation.time)) : esc(observationError || "No station observation received yet. Weather forecasts remain available.")}</p><div class="notice">No reading is converted to zero. Optional sensors remain unavailable until the station reports them.</div><div class="dialog-actions"><button class="button primary" data-finish>Finish</button></div>`;
}

async function checkStation() {
  stationResult = '';
  const before = { ...settings() };
  try {
    if (stationBrand === 'tempest') {
      const token = $('#stationToken').value.trim();
      const stationId = $('#stationId').value.trim();
      if (!token || !/^\d+$/.test(stationId)) throw new Error('Enter a token and numeric Station ID.');
      saveSettings({ token, stationId, stationSource: '' });
      const body = await api.station(stationId);
      const station = body.stations?.[0];
      if (!station) throw new Error('Station not found or access rejected');
      const readings = await api.stationObs(stationId);
      if (readings.status?.status_code) throw new Error('Station access rejected');
      await saveHost({ token, stationId, activePlace: null, stationSource: '', stationName: station.name || station.public_name || `Tempest ${stationId}`, lat: station.latitude, lon: station.longitude });
    } else {
      const current = await snapshot();
      if (!current) throw new Error('StormDesk host is not reachable here. Run the desktop app or Docker image and open its Lite URL.');
      await saveHost({ stationSource: 'ecowitt' });
    }
    stationResult = 'success';
  } catch (error) {
    saveSettings(before);
    stationResult = /401|403/.test(error.message) ? 'Credentials were rejected. Check the complete token and Station ID.' : error.message;
  }
  if (stationResult === 'success') await refreshObservation();
  stationStep = 2;
  stationUI();
}

async function pairDevice() {
  const code = $('#pairCode').value.trim();
  const name = $('#pairName').value.trim() || 'Stormdesk Lite';
  const error = $('#pairError');
  if (!/^\d{6}$/.test(code)) { error.textContent = 'Enter the six-digit code shown by the StormDesk host.'; return; }
  try {
    const response = await fetch(`${SRV}/pair/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, name }) });
    if (!response.ok) throw new Error(response.status === 401 ? 'That code is invalid or expired.' : `Pairing failed (${response.status}).`);
    const body = await response.json();
    localStorage.setItem('wd.editorToken', body.token);
    publicViewer = false;
    await loadHost();
    stationUI();
  } catch (failure) { error.textContent = failure.message; }
}

$$('[data-page]').forEach((button) => button.addEventListener('click', () => showPage(button.dataset.page)));
$$('[data-open]').forEach((button) => button.addEventListener('click', () => openDialog(button.dataset.open)));
$$('[data-close]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
$$('[data-forecast]').forEach((button) => button.addEventListener('click', () => { $$('[data-forecast]').forEach((peer) => peer.setAttribute('aria-pressed', String(peer === button))); renderForecast(button.dataset.forecast); }));
$('#locationButton').addEventListener('click', () => openDialog('locationDialog'));
$('#locationForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $('#locationInput');
  const submit = event.submitter;
  submit.disabled = true;
  try {
    const body = await api.geocode(input.value.trim());
    const place = body.features?.[0];
    if (!place) throw new Error('No matching place found. Try a town and state or a ZIP code.');
    const [lon, lat] = place.geometry.coordinates;
    const name = api.placeLabel(place.properties);
    browsePlace(lat, lon, name);
    $('#locationButton').textContent = `⌖ ${name}`;
    $('#locationDialog').close();
    radarLoaded = false;
    await refresh();
  } catch (error) { $('.location-error').textContent = error.message; }
  finally { submit.disabled = false; }
});
$('#returnStation').addEventListener('click', () => { saveSettings({ activePlace: null }); baseForecast = null; $('#locationButton').textContent = settings().stationName || 'My station'; radarLoaded = false; refresh(); });
$('#connectButton').addEventListener('click', () => { stationStep = 0; stationResult = ''; stationUI(); openDialog('stationDialog'); });
$('#settingsButton').addEventListener('click', () => openDialog('settingsDialog'));
$('#settingsForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  await saveHost({ units: $('#unitsSelect').value });
  document.documentElement.dataset.theme = $('#themeSelect').value;
  localStorage.setItem('wd.liteTheme', $('#themeSelect').value);
  $('#settingsDialog').close();
  await refresh();
});
$('#radarPlay').addEventListener('click', () => $('#radarViewer').hidden ? playRadar() : stopRadar());
$('#stationStep').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.brand) { stationBrand = button.dataset.brand; stationStep = 1; stationUI(); }
  if (button.dataset.back !== undefined) { stationStep = Math.max(0, stationStep - 1); stationUI(); }
  if (button.dataset.check !== undefined) checkStation();
  if (button.dataset.pair !== undefined) pairDevice();
  if (button.dataset.next !== undefined) { stationStep = Math.min(3, stationStep + 1); stationUI(); }
  if (button.dataset.finish !== undefined) { $('#stationDialog').close(); refresh(); }
});

const destinations = {
  'Station details': '../#signals', 'History and analysis': '../#data',
  'Timeline and local signals': '../#timeline', 'Alert rules': '../#desk',
  Integrations: '../#home', 'Backup and export': '../#data', Account: '../',
};
$$('[data-preview]').forEach((button) => button.addEventListener('click', () => { const title = button.dataset.preview.split('|')[0]; location.href = destinations[title] || '../'; }));

async function start() {
  const initial = new URLSearchParams(location.search);
  document.documentElement.dataset.theme = ['light', 'dark', 'system'].includes(initial.get('theme')) ? initial.get('theme') : localStorage.getItem('wd.liteTheme') || 'system';
  $('#themeSelect').value = document.documentElement.dataset.theme;
  await loadHost();
  if (settings().token && settings().stationId && !settings().stationSource) {
    try {
      const body = await api.station();
      const station = body.stations?.[0];
      if (station && Number.isFinite(station.latitude) && Number.isFinite(station.longitude)) saveSettings({ lat: station.latitude, lon: station.longitude, stationName: station.name || station.public_name || settings().stationName });
    } catch { /* Observation refresh reports connection errors without losing saved settings. */ }
  }
  const lat = Number(initial.get('lat')), lon = Number(initial.get('lon'));
  if (initial.get('lat')?.trim() && initial.get('lon')?.trim() && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) browsePlace(lat, lon, initial.get('name') || 'Selected location');
  $('#unitsSelect').value = settings().units;
  const point = coords();
  if (point.name) $('#locationButton').textContent = `⌖ ${point.name}`;
  sites = await fetch('../sites.json').then((response) => response.json()).catch(() => []);
  await refresh();
  if (['today', 'forecast', 'radar', 'more'].includes(initial.get('page'))) showPage(initial.get('page'));
  setInterval(() => { if (!document.hidden) refreshForecast(); }, 300000);
  setInterval(() => { if (!document.hidden) refreshObservation(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
}

start();
