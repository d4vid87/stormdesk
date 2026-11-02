// Forecast snapshots, change diffs, and forecast-vs-actual verification.
// All localStorage; no server, no history API needed.
import { load, store, settings, U, num } from './app.js';
import { cacheContext } from './desk.js';

// Which unit system an entry was recorded under. Comparing an °F forecast against a °C reading
// is not a forecast error, it is a units error — those entries are skipped rather than converted,
// because a converted history implies a precision it never had.
const units = () => (settings().units === 'metric' ? 'm' : 'i');

const SNAP_KEY = 'wd.snap', VERIFY_KEY = 'wd.verify';
const SNAP_MIN_GAP_H = 3, SNAP_CAP = 60, VERIFY_CAP = 200;
const COMPARE_MIN_AGE_H = 20;
const H = 3600e3;

const context = () => cacheContext('forecast');
const snaps = () => {
  const saved = load(SNAP_KEY, []);
  return Array.isArray(saved) ? saved.filter(s => s && Number.isFinite(s.t) && Array.isArray(s.daily)) : [];
};
const verifies = () => {
  const saved = load(VERIFY_KEY, []);
  return Array.isArray(saved) ? saved.filter(v => v && Number.isFinite(v.targetHour)) : [];
};

// --- snapshots ---

function condense(fc) {
  return {
    t: Date.now(), u: units(), context: context(),
    source: fc._forecastSource || fc._provider || '',
    daily: (fc.forecast.daily || []).filter(d => Number.isFinite(d.day_start_local)).slice(0, 10).map((d) => ({
      key: String(d.day_start_local),
      label: new Date(d.day_start_local * 1000).toLocaleDateString([], { weekday: 'short' }),
      hi: d.air_temp_high, lo: d.air_temp_low, pop: d.precip_probability, cond: d.conditions,
    })),
  };
}

// Cheap gate before the parse: snapshots are 3 h apart, and this runs on every forecast fetch.
let lastSnapT = 0, lastSnapContext = '';

export function snapshot(fc) {
  if (!fc?.forecast || fc._cached) return snaps();
  const key = context(), source = fc._forecastSource || fc._provider || '';
  const gate = key + source;
  if (lastSnapContext === gate && lastSnapT && Date.now() - lastSnapT < SNAP_MIN_GAP_H * H) return snaps();
  const list = snaps();
  const last = [...list].reverse().find(s => s.context === key && s.source === source);
  if (last && Date.now() - last.t < SNAP_MIN_GAP_H * H) {
    lastSnapT = last.t; lastSnapContext = gate;
    return list;
  }
  const next = condense(fc);
  list.push(next);
  while (list.length > SNAP_CAP) list.shift();
  lastSnapT = next.t; lastSnapContext = gate;
  // A just-created snapshot is not a previous forecast, even if another listener runs later.
  fc._snapshotAt = next.t;
  store(SNAP_KEY, list);
  return list;
}

// Diff current forecast against the newest snapshot at least COMPARE_MIN_AGE_H old.
export function changes(fc, minAgeHours = COMPARE_MIN_AGE_H) {
  if (!fc?.forecast || fc._cached) return { age: null, items: [] };
  const now = condense(fc);
  const cutoff = Date.now() - minAgeHours * H;
  const old = [...snaps()].reverse().find(s => s.t <= cutoff && s.t < Date.now()
    && s.t !== fc._snapshotAt && s.context === now.context && s.source === now.source && s.u === now.u
    && s.daily.some(d => now.daily.some(n => n.key === d.key)));
  if (!old) return { age: null, items: [] };
  const items = [];
  const tempThreshold = units() === 'm' ? 3 / 1.8 : 3;
  for (const d of now.daily) {
    const o = old.daily.find(x => x.key === d.key);
    if (!o) continue;
    const bits = [];
    if (Number.isFinite(d.hi) && Number.isFinite(o.hi) && Math.abs(d.hi - o.hi) >= tempThreshold)
      bits.push(`high ${num(o.hi)}→${num(d.hi)}${U.temp()}`);
    if (Number.isFinite(d.lo) && Number.isFinite(o.lo) && Math.abs(d.lo - o.lo) >= tempThreshold)
      bits.push(`low ${num(o.lo)}→${num(d.lo)}${U.temp()}`);
    if (Number.isFinite(d.pop) && Number.isFinite(o.pop) && Math.abs(d.pop - o.pop) >= 20)
      bits.push(`rain ${num(o.pop)}%→${num(d.pop)}%`);
    if (typeof d.cond === 'string' && typeof o.cond === 'string' && d.cond !== o.cond)
      bits.push(`${o.cond}→${d.cond}`);
    if (bits.length) items.push({ key: d.key, day: d.label, text: bits.join(', ') });
  }
  return { age: Math.round((Date.now() - old.t) / H), base: old.t, items };
}

// --- verification: record what was forecast for a future hour, score it when that hour arrives ---

// The 24-hour-out hour only changes once an hour; the forecast is fetched every five minutes.
let lastTargetHour = 0, lastTargetContext = '';

export function recordForecast(fc) {
  if (!fc?.forecast || fc._cached) return;
  const key = context();
  const hourly = fc.forecast.hourly || [];
  const t = hourly.find((h) => h.time * 1000 > Date.now() + 24 * H);
  if (t && t.time === lastTargetHour && key === lastTargetContext) return;
  if (t) { lastTargetHour = t.time; lastTargetContext = key; }
  const list = verifies();
  // one prediction per fetch: the hour 24h out
  const target = t;
  if (target && !list.some((v) => v.targetHour === target.time && v.context === key)) {
    list.push({
      targetHour: target.time, leadH: 24, u: units(), context: key,
      fTemp: target.air_temperature, fPop: target.precip_probability,
      obsTemp: null, obsPrecip: null,
    });
  }
  while (list.length > VERIFY_CAP) list.shift();
  store(VERIFY_KEY, list);
}

// Called with current station obs; fills in any prediction whose target hour is now.
export function scoreForecast(obs) {
  if (!obs) return;
  const now = Date.now();
  const list = verifies();
  let dirty = false;
  for (const v of list) {
    if (v.obsTemp != null) continue;
    if (v.u !== units() || v.context !== context()) continue;
    if (Math.abs(v.targetHour * 1000 - now) < 30 * 60e3) {
      v.obsTemp = obs.air_temperature;
      v.obsPrecip = (obs.precip_accum_last_1hr || 0) > 0;
      dirty = true;
    }
  }
  if (dirty) store(VERIFY_KEY, list);
}

export function accuracy() {
  const scored = verifies().filter((v) => Number.isFinite(v.obsTemp) && Number.isFinite(v.fTemp) && v.u === units() && v.context === context());
  const errs = scored.map((v) => Math.abs(v.fTemp - v.obsTemp));
  return {
    n: scored.length,
    mae: errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : null,
    recent: scored.slice(-8).reverse(),
  };
}

export function clearAll() {
  localStorage.removeItem(SNAP_KEY);
  localStorage.removeItem(VERIFY_KEY);
  lastSnapT = 0; lastSnapContext = ''; lastTargetHour = 0; lastTargetContext = '';
}
