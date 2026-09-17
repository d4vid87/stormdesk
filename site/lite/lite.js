import { settings, saveSettings, coords, U, msToWind, deg2compass, num, timeStr, dayStr, expires } from '../js/app.js';
import * as api from '../js/api.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const SRV = window.__WD_SRV || '';
let latest = null;
let sites = [];
let radarLoaded = false;
let stationStep = 0;
let stationBrand = 'tempest';
let stationResult = '';
let publicViewer = false;

const icon = (name = '') => {
  if (name.includes('thunder')) return '⛈️';
  if (name.includes('snow')) return '🌨️';
  if (name.includes('sleet')) return '🌧️';
  if (name.includes('rain')) return '🌦️';
  if (name.includes('fog')) return '🌫️';
  if (name.includes('cloudy') && !name.includes('partly')) return '☁️';
  if (name.includes('clear-night') || name.includes('partly-cloudy-night')) return '🌙';
  if (name.includes('clear')) return '☀️';
  return '⛅';
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
  if (!current || Date.now() / 1000 - current.at > 3600) return forecast;
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
  $('.weather-icon').textContent = icon(c.icon);
  $('.condition-copy').firstChild.textContent = c.conditions || 'Conditions unavailable';
  $('.condition-copy small').textContent = `Feels like ${num(c.feels_like)}°`;
  $('.condition-copy').parentElement.nextElementSibling.innerHTML = `High <strong>${num(today.air_temp_high)}°</strong> · Low <strong>${num(today.air_temp_low)}°</strong>`;
  $('#windValue').textContent = c.wind_avg == null ? 'Unavailable' : `${deg2compass(c.wind_direction)} ${num(c.wind_avg)} ${U.wind()}`;
  $('.stat:nth-child(2) strong').textContent = c.relative_humidity == null ? 'Unavailable' : `${num(c.relative_humidity)}%`;
  $('#rainValue').textContent = c.precip_accum_local_day == null ? 'Unavailable' : `${num(c.precip_accum_local_day, 2)} ${U.precip()}`;
  $('.stat:nth-child(4) strong').textContent = today.precip_probability == null ? 'Unavailable' : `${num(today.precip_probability)}%`;
  const stale = c.time && Date.now() / 1000 - c.time > (forecast._station ? 300 : 5400);
  const source = forecast._station?.name || (settings().stationSource ? settings().stationName || 'Personal station' : 'Open-Meteo');
  $('#sourceLine').innerHTML = `Weather source: ${esc(source)} · <span class="${stale ? 'stale' : ''}">${age(c.time)}</span>`;
  $('#todayHourly').innerHTML = hours.slice(0, 6).map((h, i) => `<div class="hour"><span>${i ? timeStr(h.time) : 'Now'}</span><i aria-hidden="true">${icon(h.icon)}</i><b>${num(h.air_temperature)}°</b><span>${h.precip_probability == null ? 'Rain —' : `${num(h.precip_probability)}% rain`}</span></div>`).join('');
  $('#fiveDay').innerHTML = days.slice(0, 5).map((d, i) => `<div class="day card"><span>${i ? dayStr(d.day_start_local) : 'Today'}</span><i aria-hidden="true">${icon(d.icon)}</i><b>${num(d.air_temp_high)}° <span class="low">${num(d.air_temp_low)}°</span></b><span>${d.precip_probability == null ? 'Rain —' : `${num(d.precip_probability)}% rain`}</span></div>`).join('');
  renderForecast($('#forecastList').dataset.mode || 'hourly');
  const connected = !!forecast._station?.name || !!settings().stationSource || !!settings().token;
  $('#connectTitle').textContent = connected ? settings().stationName || forecast._station?.name || 'Personal weather station' : 'Have a weather station?';
  $('#connectCopy').textContent = connected ? `${stale ? 'Data stale' : 'Connected'} · ${age(c.time)}` : 'Connect it to replace public observations with readings from your own backyard.';
  $('#connectButton').textContent = connected ? 'Manage station' : 'Connect station';
  $('#stationStatus').innerHTML = `<i class="status-dot"></i>${connected ? `${settings().stationName || forecast._station?.name || 'Station'} connected` : 'Forecast-only mode'}`;
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

async function refresh() {
  if (coords().lat == null) { openDialog('locationDialog'); return; }
  $('#sourceLine').textContent = 'Updating weather…';
  try {
    const [forecast, current] = await Promise.all([api.betterForecast(), snapshot()]);
    render(current ? overlaySnapshot(forecast, current) : forecast);
    localStorage.setItem('wd.liteForecast', JSON.stringify(forecast));
  } catch (error) {
    const cached = JSON.parse(localStorage.getItem('wd.liteForecast') || 'null');
    if (cached) { render(cached); $('#sourceLine').innerHTML = `<span class="stale">Cached weather · update failed</span>`; }
    else $('#sourceLine').innerHTML = `<span class="stale">Weather unavailable · ${error.message}</span>`;
  }
  refreshAlerts();
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
    $('#warningDialog .dialog-body').innerHTML = `<div class="eyebrow">Official warning</div><p><strong>${p.headline || p.areaDesc || ''}</strong></p><p>${(p.description || '').replace(/[<>]/g, '')}</p><div class="notice">Source: National Weather Service · ${age(Date.parse(p.sent) / 1000)}</div><div class="dialog-actions"><button class="button primary" type="button" data-close>Done</button></div>`;
  } catch { $('#warningBanner').hidden = true; }
}

function showPage(name) {
  $$('.page').forEach((page) => { page.hidden = page.id !== `${name}Page`; });
  $$('nav [data-page]').forEach((button) => button.toggleAttribute('aria-current', button.dataset.page === name));
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
  frame.src = '';
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
  if (stationStep === 3) $('#stationStep').innerHTML = `<div class="eyebrow">Step 4 of 4</div><h3>Waiting for the first reading</h3><p>StormDesk will keep the forecast visible while the station begins reporting.</p><div class="notice">No reading is converted to zero. Optional sensors remain unavailable until the station reports them.</div><div class="dialog-actions"><button class="button primary" data-finish>Finish</button></div>`;
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
      const station = body.stations?.[0] || body;
      await saveHost({ token, stationId, stationSource: '', stationName: station.name || station.public_name || `Tempest ${stationId}`, lat: station.latitude, lon: station.longitude });
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
    await saveHost({ lat, lon, stationName: name });
    $('#locationButton').textContent = `⌖ ${name}`;
    $('#locationDialog').close();
    radarLoaded = false;
    await refresh();
  } catch (error) { $('.location-error').textContent = error.message; }
  finally { submit.disabled = false; }
});
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
  const lat = Number(initial.get('lat'));
  const lon = Number(initial.get('lon'));
  if (Number.isFinite(lat) && Number.isFinite(lon)) saveSettings({ lat, lon, stationName: initial.get('name') || 'Selected location' });
  await loadHost();
  $('#unitsSelect').value = settings().units;
  const point = coords();
  if (point.name) $('#locationButton').textContent = `⌖ ${point.name}`;
  sites = await fetch('../sites.json').then((response) => response.json()).catch(() => []);
  await refresh();
  if (['today', 'forecast', 'radar', 'more'].includes(initial.get('page'))) showPage(initial.get('page'));
  setInterval(refresh, 5 * 60 * 1000);
}

start();
