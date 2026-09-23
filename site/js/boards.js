// 04 Data — nine boards. Station history from observations/device, forecast
// intelligence from open-meteo + wd.verify, official context from NWS.
import * as api from './api.js';
import { settings, coords, configured, hasSource, U, num, every, expires } from './app.js';
import { chart } from './charts.js';
import { openDetail } from './detail.js';
import { accuracy } from './track.js';
import { forecast as deskForecast } from './desk.js';

const $ = (id) => document.getElementById(id);
const DAY = 86400;
const I = api.OBS;

let history = [];
let historyHours = 168;

function filterBoards() {
  const value = $('history-filter')?.value || 'all';
  $('data-grid').classList.toggle('filtered', value !== 'all');
  document.querySelectorAll('#data-grid > [data-panel]').forEach((card) => {
    card.hidden = value !== 'all' && card.dataset.panel !== value;
  });
  document.querySelectorAll('.snapshot-open').forEach((button) => {
    const selected = value === button.dataset.historySelect;
    button.textContent = selected ? 'Show all' : '↗';
    button.setAttribute('aria-label', selected ? 'Show all measurements' : `Explore ${button.closest('[data-panel]').querySelector('h2').textContent.toLowerCase()} history`);
  });
}

document.addEventListener('change', (event) => {
  if (event.target.id === 'history-filter') { filterBoards(); redrawVisibleCharts(); }
  if (event.target.id === 'history-range') {
    historyHours = Number(event.target.value);
    $('history-title').textContent = historyHours === 24 ? 'Your day at a glance' : 'Your week at a glance';
    refreshBoards();
  }
});
document.addEventListener('click', (event) => {
  const button = event.target.closest('.snapshot-open');
  if (!button) return;
  $('history-filter').value = $('history-filter').value === button.dataset.historySelect ? 'all' : button.dataset.historySelect;
  filterBoards();
  redrawVisibleCharts();
});

function redrawVisibleCharts() {
  if (!history.length) return;
  requestAnimationFrame(() => { drawTemp(); drawRain(); drawWind(); drawPressure(); drawRose(); });
}

const note = (id, msg) => { $(id).innerHTML = `<div class="muted">${msg}</div>`; };
const values = (idx) => history.map((o) => o[idx]).filter((v) => Number.isFinite(v));
const snapshot = (name, value, caption) => {
  $(`snapshot-${name}`).textContent = value;
  $(`snapshot-${name}-note`).textContent = caption;
};
function clearSnapshot() {
  history = [];
  for (const name of ['temp', 'rain', 'wind', 'press']) snapshot(name, '—', 'Station history unavailable');
  for (const id of ['c-temp', 'c-rain', 'c-wind', 'c-press', 'c-rose']) {
    $(id).removeAttribute('width');
    $(id).removeAttribute('height');
  }
  $('extremes').textContent = 'Station records unavailable';
  $('history-summary').querySelector('strong').textContent = 'Connect a station to see your weather history.';
}

export async function refreshBoards() {
  if (!hasSource()) {
    clearSnapshot();
    note('data-history-status', 'Connect a weather station to explore measured history. Forecast analysis remains available below.');
    drawModels(); drawAccuracy(); drawOfficial(); drawOutlook();
    return;
  }
  const end = Math.floor(Date.now() / 1000);
  try {
    const j = window.__WD_SRV !== undefined || settings().stationSource
      ? await api.localObs(historyHours)
      : await api.deviceObs(settings().deviceId, end - historyHours * 3600, end);
    history = j.obs || [];
  } catch (e) {
    clearSnapshot();
    note('data-history-status', `History unavailable: ${e.message}`);
    return;
  }
  if (!history.length) { clearSnapshot(); note('data-history-status', 'No history returned for this device.'); return; }

  $('data-history-status').textContent = '';
  filterBoards();
  drawTemp();
  drawRain();
  drawWind();
  drawRose();
  drawPressure();
  drawExtremes();
  const temperatures = values(I.temp);
  const rainDays = dailyRain();
  const rain = rainDays.reduce((total, day) => total + day.y, 0);
  $('history-summary').querySelector('strong').textContent = temperatures.length
    ? `High ${num(Math.max(...temperatures))}${U.temp()} · ${rainDays.length ? `${num(rain, 2)} ${U.precip()} of rain` : 'rain data unavailable'} in the ${historyHours === 24 ? 'last 24 hours' : 'last 7 days'}.`
    : `Station history for the ${historyHours === 24 ? 'last 24 hours' : 'last 7 days'}.`;
  drawModels();
  drawAccuracy();
  drawOfficial();
  drawOutlook();
}

const pts = (idx, from = 0) =>
  history.filter((o) => o[I.time] >= from).map((o) => ({ x: o[I.time] * 1000, y: o[idx] }));

function drawTemp() {
  // Clicking a point opens the same slide-over the gauges open, windowed on that moment.
  chart($('c-temp'), [{ data: pts(I.temp), color: '#43cfc3' }],
    { digits: 0, onPick: (p) => openDetail('temp', p.x) });
  $('board-temp').textContent = 'Temperature';
  const t = values(I.temp);
  snapshot('temp', t.length ? `${num(t.reduce((a, b) => a + b, 0) / t.length)}${U.temp()}` : '—', t.length ? 'average temperature' : 'No temperature readings');
}

// daily rain totals from the per-minute accumulation column
function dailyRain() {
  const byDay = new Map();
  for (const o of history) {
    if (!Number.isFinite(o[I.rain])) continue;
    const k = new Date(o[I.time] * 1000).setHours(0, 0, 0, 0);
    byDay.set(k, (byDay.get(k) || 0) + o[I.rain]);
  }
  return [...byDay].sort((a, b) => a[0] - b[0]).map(([x, y]) => ({ x, y }));
}

function drawRain() {
  const d = dailyRain();
  // The bars are whole days; noon is the middle of the window the detail panel will read.
  chart($('c-rain'), [{ data: d, type: 'bar', color: '#43cfc3' }],
    { yMin: 0, digits: 2, onPick: (p) => openDetail('rain', p.x + 12 * 3600 * 1000) });
  const total = d.reduce((a, b) => a + b.y, 0);
  $('board-rain').textContent = 'Rain';
  snapshot('rain', d.length ? `${num(total, 2)} ${U.precip()}` : '—', d.length ? 'total rainfall' : 'No rain readings');
}

function drawWind() {
  const from = Math.floor(Date.now() / 1000) - historyHours * 3600;
  chart($('c-wind'), [
    { data: pts(I.windGust, from), color: '#eea64b', name: 'gust' },
    { data: pts(I.windAvg, from), color: '#43cfc3', name: 'avg' },
  ], { yMin: 0, digits: 0, onPick: (p, name) => openDetail(name === 'avg' ? 'windAvg' : 'windGust', p.x) });
  $('board-wind').textContent = 'Wind';
  const gusts = values(I.windGust);
  snapshot('wind', gusts.length ? `${num(Math.max(...gusts))} ${U.wind()}` : '—', gusts.length ? 'peak gust · average shown in teal' : 'No wind readings');
}

// Where the wind actually comes from over the week: 16 sectors, petal length = share of samples,
// fill brightness = that sector's mean speed. charts.js is Cartesian-only, so this draws itself.
function drawRose() {
  const canvas = $('c-rose');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 300, h = canvas.clientHeight || 150;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);

  const n = new Array(16).fill(0), sum = new Array(16).fill(0);
  let total = 0;
  for (const o of history) {
    const d = o[I.windDir], v = o[I.windAvg];
    if (d == null || !v) continue; // calm samples have no meaningful direction
    const s = Math.round(d / 22.5) % 16;
    n[s]++; sum[s] += v; total++;
  }
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 14;
  if (!total) { c.fillStyle = '#78a989'; c.font = '12px system-ui'; c.fillText('no data', 8, cy); return; }

  const maxShare = Math.max(...n) / total;
  const maxMean = Math.max(...n.map((k, i) => (k ? sum[i] / k : 0)));
  for (let i = 0; i < 16; i++) {
    if (!n[i]) continue;
    const r = R * (n[i] / total / maxShare);
    const a = i * 22.5 * Math.PI / 180 - Math.PI / 2; // 0° = north = straight up
    const half = 11 * Math.PI / 180;
    c.beginPath();
    c.moveTo(cx, cy);
    c.arc(cx, cy, r, a - half, a + half);
    c.closePath();
    c.fillStyle = `rgba(57, 255, 136, ${0.25 + 0.75 * (sum[i] / n[i]) / (maxMean || 1)})`;
    c.fill();
  }
  c.strokeStyle = '#174c2d';
  c.beginPath(); c.arc(cx, cy, R, 0, 2 * Math.PI); c.stroke();
  c.fillStyle = '#78a989'; c.font = '10px system-ui'; c.textAlign = 'center';
  [['N', 0, -R - 4], ['E', R + 6, 3], ['S', 0, R + 11], ['W', -R - 6, 3]]
    .forEach(([lab, dx, dy]) => c.fillText(lab, cx + dx, cy + dy));
  c.textAlign = 'left';
  $('board-rose').textContent = `${historyHours === 24 ? '24h' : '7-day'} wind rose (${U.wind()}) — petal length is how often, brightness is how fast`;
}

function drawPressure() {
  const from = Math.floor(Date.now() / 1000) - historyHours * 3600;
  chart($('c-press'), [{ data: pts(I.press, from), color: '#aaffc4' }],
    { digits: 2, onPick: (p) => openDetail('press', p.x) });
  const p = pts(I.press, from);
  const delta = p.length > 1 ? p[p.length - 1].y - p[0].y : 0;
  $('board-press').textContent = 'Pressure';
  const pressure = values(I.press);
  snapshot('press', pressure.length ? num(pressure[pressure.length - 1], 2) : '—', pressure.length ? `${U.press()} · ${p.length > 1 ? `change ${delta >= 0 ? '+' : ''}${num(delta, 2)}` : 'latest reading'}` : 'No pressure readings');
}

function drawExtremes() {
  $('board-records').textContent = `Records · ${historyHours === 24 ? '24 hours' : '7 days'}`;
  const col = (i) => history.map((o) => o[i]).filter((v) => v != null);
  const t = col(I.temp), g = col(I.windGust);
  const strikes = col(I.strikes).reduce((a, b) => a + b, 0);
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  $('extremes').innerHTML = [
    ['High', `${num(Math.max(...t), 1)}${U.temp()}`, 'temp'],
    ['Low', `${num(Math.min(...t), 1)}${U.temp()}`, 'temp'],
    ['Mean', `${num(avg(t), 1)}${U.temp()}`, 'temp'],
    ['Peak gust', `${num(Math.max(...g), 1)} ${U.wind()}`, 'windGust'],
    ['Lightning strikes', num(strikes), 'strikes'],
    ['Samples', num(history.length)],
  ].map(([k, v, m]) => `<div${m ? ` data-metric="${m}" role="button" tabindex="0"` : ''}><span>${k}</span><span>${v}</span></div>`).join('');
}

async function drawModels() {
  const m = await api.multiModel().catch(() => null);
  if (!m) return note('board-models', 'Open-Meteo unavailable.');
  const colors = { gfs_seamless: '#45a7ff', ecmwf_ifs025: '#43cfc3', icon_seamless: '#eea64b', gem_seamless: '#ff4d5a' };
  const series = api.MODELS.split(',').map((k) => ({
    color: colors[k],
    data: (m.hourly[`temperature_2m_${k}`] || []).map((y, i) => ({ x: new Date(m.hourly.time[i]).getTime(), y })),
  }));
  chart($('c-models'), series, { digits: 0, xFormat: (x) => new Date(x).toLocaleString([], { weekday: 'short', hour: 'numeric' }) });
  $('board-models').innerHTML = 'Model temps · <span style="color:#45a7ff">GFS</span> '
    + '<span style="color:#43cfc3">ECMWF</span> <span style="color:#eea64b">ICON</span> <span style="color:#ff4d5a">GEM</span>';
}

function drawAccuracy() {
  const a = accuracy();
  chart($('c-accuracy'), [{
    type: 'bar', color: '#43cfc3',
    data: a.recent.map((v) => ({ x: v.targetHour * 1000, y: v.fTemp - v.obsTemp })),
  }], { digits: 1 });
  $('board-accuracy').textContent = a.n
    ? `24h-lead temp error — MAE ${num(a.mae, 1)}${U.temp()} over ${a.n} checks`
    : '24h-lead temp error — collecting, first score lands 24h after setup';
}

async function drawOfficial() {
  const fc = deskForecast();
  try {
    const p = await api.nwsPoint();
    const nws = await (await fetch(p.properties.forecast, { signal: expires(15000) })).json();
    const periods = nws.properties.periods.slice(0, 6);
    const tempestDaily = fc?.forecast?.daily || [];
    // Match on the period's own date, not its position: an afternoon load starts the list at
    // "Tonight", and every row after it compared against the wrong day.
    const dayOf = (t) => new Date(t).toDateString();
    $('official').innerHTML = periods.map((pd) => {
      const mine = tempestDaily.find((d) => dayOf(d.day_start_local * 1000) === dayOf(pd.startTime));
      const ref = pd.isDaytime ? mine?.air_temp_high : mine?.air_temp_low;
      const d = ref == null ? null : pd.temperature - ref;
      return `<div><span>${pd.name}</span><span>NWS ${pd.temperature}° · Tempest ${num(ref)}°`
        + `${d == null ? '' : ` (${d >= 0 ? '+' : ''}${num(d)})`}</span></div>`;
    }).join('');
  } catch (e) {
    note('official', `NWS gridpoint unavailable: ${e.message}`);
  }
}

async function drawOutlook() {
  const s = coords();
  const imperial = settings().units !== 'metric';
  try {
    const j = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${s.lat}&longitude=${s.lon}`
      + `&daily=precipitation_sum,precipitation_probability_max&forecast_days=7&timezone=auto`
      + (imperial ? '&precipitation_unit=inch' : ''), { signal: expires(15000) })).json();
    // 'YYYY-MM-DD' parses as UTC midnight, which is the previous day west of Greenwich — noon
    // local is the same trick almanac.js uses.
    const data = j.daily.time.map((t, i) => ({ x: new Date(`${t}T12:00`).getTime(), y: j.daily.precipitation_sum[i] }));
    chart($('c-qpf'), [{ data, type: 'bar', color: '#43cfc3' }], { yMin: 0, digits: 2 });
    const total = data.reduce((a, b) => a + (b.y || 0), 0);
    $('board-qpf').textContent = `7-day precip outlook — ${num(total, 2)} ${U.precip()} total`;
  } catch (e) {
    note('board-qpf', `Outlook unavailable: ${e.message}`);
  }
}

// history is heavy; refresh on tab entry and hourly, not on the desk cadence. Module level so a
// re-init doesn't stack listeners.
window.addEventListener('wd:section', (e) => { if (e.detail === 'data') refreshBoards().catch(() => {}); });

export function initBoards() {
  every('boards', 3600, () => {
    if (document.getElementById('data').classList.contains('active')) refreshBoards();
  });
}
