// 04b Almanac — all-time records, this day last year, month by month.
//
// Source is the desktop app's own observation log (`/history/daily`), not the Tempest REST API:
// the REST history is capped and paged, and the point of the log is to keep going once it ends.
// Nothing here backfills — the archive starts the day the app was first run, and the panel says
// so rather than pretending the record is older than it is.
import { settings, coords, U, num, every, expires, msToWind } from './app.js';
import { chart } from './charts.js';
import { openDetail } from './detail.js';
import { normals, normalFor, monthlyPrecipArchive, getJSON } from './api.js';

const $ = (id) => document.getElementById(id);
const SRV = window.__WD_SRV || '';

// The log is SI, exactly as the hub broadcast it — the same conversion deviceObs() does, in the
// one place the almanac needs it.
export function toDisplay(row) {
  const metric = settings().units === 'metric';
  const t = (c) => (c == null ? null : metric ? c : c * 9 / 5 + 32);
  const wind = msToWind;
  const rain = (mm) => (mm == null ? null : mm * (metric ? 1 : 1 / 25.4));
  return {
    day: row.day,
    tempMin: t(row.tempMin), tempMax: t(row.tempMax),
    gustMax: wind(row.gustMax), rain: rain(row.rain),
    strikes: row.strikes, battMin: row.battMin,
  };
}

let days = [];

async function load() {
  // The browser's own offset, because the process has no timezone and "a day" has to mean the
  // day the user lived through.
  const tz = -new Date().getTimezoneOffset();
  days = (await getJSON(`${SRV}/history/daily?tz=${tz}`)).map(toDisplay);
}

const note = (msg) => {
  $('almanac').innerHTML = `<div class="muted">${msg}</div>`;
  $('board-monthly').textContent = 'Month by month';
};

// Widest value of a column, and the day it happened on.
export function extreme(rows, key, cmp) {
  let best = null;
  for (const d of rows) {
    if (d[key] == null) continue;
    if (!best || cmp(d[key], best[key])) best = d;
  }
  return best;
}

const pretty = (day) => new Date(`${day}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

export async function refreshAlmanac() {
  try {
    await Promise.all([load(), loadCoverage()]);
  } catch {
    // Browser and Android installs have no log server; say which app has the archive rather
    // than leaving an empty card.
    note('Records come from the desktop app’s observation log — open StormDesk on the machine with the hub.');
    return;
  }
  if (!days.length) {
    note('Collecting. Records appear after the first full day of observations.');
    return;
  }

  const hi = extreme(days, 'tempMax', (a, b) => a > b);
  const lo = extreme(days, 'tempMin', (a, b) => a < b);
  const gust = extreme(days, 'gustMax', (a, b) => a > b);
  const wet = extreme(days, 'rain', (a, b) => a > b);
  const zap = extreme(days, 'strikes', (a, b) => a > b);

  // Same calendar day, a year back. Missing is the normal case in year one.
  const now = new Date();
  const lastYear = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  const key = `${lastYear.getFullYear()}-${String(lastYear.getMonth() + 1).padStart(2, '0')}-${String(lastYear.getDate()).padStart(2, '0')}`;
  const then = days.find((d) => d.day === key);

  const row = (k, v, when) => `<div><span>${k}</span><span>${v}${when ? ` <span class="muted">${pretty(when)}</span>` : ''}</span></div>`;
  $('almanac').innerHTML = [
    hi && row('Hottest', `${num(hi.tempMax, 1)}${U.temp()}`, hi.day),
    lo && row('Coldest', `${num(lo.tempMin, 1)}${U.temp()}`, lo.day),
    gust && row('Peak gust', `${num(gust.gustMax, 1)} ${U.wind()}`, gust.day),
    wet && row('Wettest day', `${num(wet.rain, 2)} ${U.precip()}`, wet.day),
    zap && zap.strikes ? row('Most lightning', `${num(zap.strikes)} strikes`, zap.day) : '',
    row('This day last year', then
      ? `${num(then.tempMax, 0)}° / ${num(then.tempMin, 0)}°, ${num(then.rain, 2)} ${U.precip()}`
      : 'no record yet'),
    row('Records since', pretty(days[0].day)),
    row('Days on record', num(days.length)),
    coverageNote(),
  ].filter(Boolean).join('');

  drawMonthly();
  drawExplore();
}

// The archive can reach back further than the app has been running — see the backfill in the
// desktop server. Saying which is the difference between "we have one week" and "we have eight
// years and are still fetching".
let coverage = null;
async function loadCoverage() {
  try {
    const r = await fetch(`${SRV}/history/coverage`, { signal: expires(5000) });
    coverage = r.ok ? await r.json() : null;
  } catch { coverage = null; }
}

function coverageNote() {
  if (!coverage) return '';
  const state = coverage.backfill === 'running'
    ? 'still fetching older observations from WeatherFlow'
    : ['done', 'complete'].includes(coverage.backfill) ? 'backfilled from WeatherFlow' : 'from this app only';
  return `<div><span>Archive</span><span class="muted">${num(coverage.count)} observations · ${state}</span></div>`;
}

// Rain by month, because it is the number a year of logging actually answers.
function drawMonthly() {
  const months = new Map();
  for (const d of days) {
    const m = d.day.slice(0, 7);
    const acc = months.get(m) || { rain: 0, hi: null, lo: null };
    acc.rain += d.rain || 0;
    if (d.tempMax != null) acc.hi = acc.hi == null ? d.tempMax : Math.max(acc.hi, d.tempMax);
    if (d.tempMin != null) acc.lo = acc.lo == null ? d.tempMin : Math.min(acc.lo, d.tempMin);
    months.set(m, acc);
  }
  const data = [...months].map(([m, v]) => ({ x: new Date(`${m}-15T12:00:00`).getTime(), y: v.rain }));
  // Last year's months on the same axis, shifted forward a year so they line up with this
  // year's — the comparison everybody makes by eye anyway, drawn.
  const prior = data.map((p) => {
    const d = new Date(p.x);
    const key = `${d.getFullYear() - 1}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const v = months.get(key);
    return v ? { x: p.x, y: v.rain } : { x: p.x, y: null };
  });
  const series = [{ data, type: 'bar', color: '#4fb8ff', name: 'this year' }];
  if (prior.some((p) => p.y != null)) series.push({ data: prior, color: 'var(--muted)', dash: [4, 3], name: 'last year' });
  chart($('c-monthly'), series, { yMin: 0, digits: 2, label: 'rain by month', unit: U.precip() });
  $('board-monthly').textContent = `Rain by month (${U.precip()}) — ${months.size} month${months.size === 1 ? '' : 's'} on record`;
}

// --- explorer: any date range, any column ---

// Which per-reading metric each daily column is a summary of. `battMin` is missing on purpose:
// detail.js has no battery entry, and a chart of the chart is what the panel is not for.
const EXPLORE_DETAIL = {
  tempMin: 'temp', tempMax: 'temp', gustMax: 'windGust', rain: 'rain', strikes: 'strikes',
};

function drawExplore() {
  const from = $('ex-from').value || days[0]?.day;
  const to = $('ex-to').value || days[days.length - 1]?.day;
  const key = $('ex-metric').value;
  const rows = days.filter((d) => d.day >= from && d.day <= to && d[key] != null);
  const digits = key === 'rain' ? 2 : key === 'strikes' ? 0 : 1;
  const unit = key === 'rain' ? U.precip() : key === 'gustMax' ? U.wind() : key === 'strikes' ? '' : U.temp();
  chart($('c-explore'), [{
    data: rows.map((d) => ({ x: new Date(`${d.day}T12:00:00`).getTime(), y: d[key] })),
    color: '#4fb8ff',
    type: key === 'rain' || key === 'strikes' ? 'bar' : 'line',
  }], {
    digits, unit, label: $('ex-metric').selectedOptions[0].textContent,
    yMin: key === 'rain' ? 0 : undefined,
    // A daily row is a summary of a day; the detail panel shows the readings behind it. Battery
    // has no detail entry, so that column simply is not clickable.
    onPick: EXPLORE_DETAIL[key] ? (p) => openDetail(EXPLORE_DETAIL[key], p.x) : undefined,
  });
  if (!rows.length) { $('ex-summary').textContent = 'No observations in that range.'; return; }
  const vals = rows.map((d) => d[key]);
  const total = vals.reduce((a, b) => a + b, 0);
  $('ex-summary').textContent = `${rows.length} days · min ${num(Math.min(...vals), digits)}${unit}`
    + ` · max ${num(Math.max(...vals), digits)}${unit}`
    + ` · ${key === 'rain' || key === 'strikes' ? `total ${num(total, digits)}${unit}` : `mean ${num(total / vals.length, digits)}${unit}`}`;
}

// --- normals: what the date usually looks like, from 30 years of ERA5 ---

let normalDays = null, normalContext = '';

async function normalDaysForPlace() {
  const c = coords();
  if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) return null;
  const key = JSON.stringify([c.lat, c.lon, settings().units]);
  if (key !== normalContext || !normalDays) {
    normalContext = key;
    const request = normals(c.lat, c.lon).catch(() => {
      if (normalDays === request) normalDays = null;
      return null;
    });
    normalDays = request;
  }
  const days = await normalDays;
  if (key !== JSON.stringify([coords().lat, coords().lon, settings().units])) return null;
  return days;
}

export async function normalToday(date = new Date()) {
  return normalFor(await normalDaysForPlace(), date);
}

const calendarKey = date => date.toISOString().slice(0, 10);

export function monthlyPrecipComparison(archive, baseline, date, metric = false) {
  if (archive?.daily_units?.precipitation_sum !== (metric ? 'mm' : 'inch'))
    return null;
  const daily = archive.daily || {}, rows = new Map(), duplicates = new Set();
  (daily.time || []).forEach((day, i) => {
    if (rows.has(day)) duplicates.add(day);
    rows.set(day, daily.precipitation_sum?.[i]);
  });
  const year = date.getFullYear(), month = date.getMonth();
  // ERA5 arrives several days late; only use a period with every completed day represented.
  for (let back = 0; back <= 2; back++) {
    const first = new Date(Date.UTC(year, month - back, 1));
    const last = back ? new Date(Date.UTC(year, month - back + 1, 0))
      : new Date(Date.UTC(year, month, date.getDate() - 1));
    if (last < first) continue;
    let total = 0, normal = 0, count = 0, complete = true;
    for (const day = new Date(first); day <= last; day.setUTCDate(day.getUTCDate() + 1)) {
      const key = calendarKey(day), amount = rows.get(key), avg = baseline?.[key.slice(5)];
      const years = key.endsWith('-02-29') ? 8 : 30;
      if (duplicates.has(key) || !Number.isFinite(amount) || amount < 0
          || !Number.isFinite(avg?.precip) || avg.precip < 0 || avg.precipYears !== years) {
        complete = false; break;
      }
      total += amount; normal += avg.precip; count++;
    }
    if (complete) return { start: calendarKey(first), end: calendarKey(last), total, normal, days: count, currentMonth: back === 0 };
  }
  return null;
}

let monthlyNormalContext = '', monthlyNormalRequest = null;
export async function monthlyPrecipNormal(date) {
  const c = coords();
  if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon) || !(date instanceof Date) || !Number.isFinite(date.getTime())) return null;
  const today = calendarKey(new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())));
  const key = JSON.stringify([c.lat, c.lon, settings().units, today]);
  if (monthlyNormalContext !== key || !monthlyNormalRequest) {
    monthlyNormalContext = key;
    const start = calendarKey(new Date(Date.UTC(date.getFullYear(), date.getMonth() - 2, 1)));
    const end = calendarKey(new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate() - 1)));
    const metric = settings().units === 'metric';
    const request = Promise.all([monthlyPrecipArchive(start, end, c.lat, c.lon), normalDaysForPlace()])
      .then(([archive, baseline]) => monthlyPrecipComparison(archive, baseline, date, metric))
      .catch(() => { if (monthlyNormalRequest === request) monthlyNormalRequest = null; return null; });
    monthlyNormalRequest = request;
  }
  const result = await monthlyNormalRequest;
  if (key !== JSON.stringify([coords().lat, coords().lon, settings().units, today])) return null;
  return result;
}

window.addEventListener('wd:section', (e) => { if (e.detail === 'data') refreshAlmanac(); });

export function initAlmanac() {
  $('btn-explore').onclick = drawExplore;
  every('almanac', 3600, () => {
    if ($('data').classList.contains('active')) refreshAlmanac();
  });
}

// ponytail-lite self-check: the record picker and the SI conversion, the two places a wrong
// answer would read as a plausible record.
if (location.search.includes('selftest')) {
  const rows = [{ day: '2025-01-01', tempMax: 10 }, { day: '2025-01-02', tempMax: null }, { day: '2025-01-03', tempMax: 30 }];
  console.assert(extreme(rows, 'tempMax', (a, b) => a > b).day === '2025-01-03', 'almanac: hottest day');
  console.assert(extreme(rows, 'tempMax', (a, b) => a < b).day === '2025-01-01', 'almanac: coldest ignores nulls');
  console.assert(extreme([], 'tempMax', (a, b) => a > b) === null, 'almanac: empty log has no record');
  const d = toDisplay({ day: '2025-01-01', tempMax: 0, gustMax: 10, rain: 25.4, strikes: 1, battMin: 2.6 });
  const imperial = settings().units !== 'metric';
  console.assert(Math.abs(d.tempMax - (imperial ? 32 : 0)) < 0.01, 'almanac: temp conversion');
  console.assert(Math.abs(d.rain - (imperial ? 1 : 25.4)) < 0.01, 'almanac: rain conversion');
}
