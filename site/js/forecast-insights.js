import { settings, coords, U, num } from './app.js';
import { forecast, cacheContext } from './desk.js';
import { multiModel } from './api.js';
import { normalToday, monthlyPrecipNormal } from './almanac.js';
import { snapshot, changes } from './track.js';
import { forecastTime } from './weather-context.js';

const MODEL_MAX_AGE = 3 * 3600;
let models = null, modelContext = '', modelRequest = null, requestContext = '';

// Daily extrema need a whole day; precipitation is the preceding hour, including next midnight.
export function modelDayRange(data, start, end, metric = false, now = Date.now() / 1000) {
  const unavailable = reason => ({ available: false, reason });
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    return unavailable('No valid forecast day selected.');
  const age = now - data?._fetchedAt;
  if (!Number.isFinite(age) || age < -60 || age > MODEL_MAX_AGE || data?._cached)
    return unavailable('Model comparison is unavailable or out of date.');
  const h = data?.hourly, units = data?.hourly_units || {};
  if (!Array.isArray(h?.time)) return unavailable('Model comparison is unavailable.');
  const hours = (end - start) / 3600;
  if (!Number.isInteger(hours) || hours < 23 || hours > 25)
    return unavailable('A complete forecast day is required.');
  const times = h.time.map(t => forecastTime(t, data.utc_offset_seconds));
  const indexes = (first, last) => {
    const selected = times.flatMap((t, i) => t >= first && t <= last ? [i] : []);
    return selected.length === hours && selected.every((i, n) => times[i] === first + n * 3600) ? selected : [];
  };
  const temperature = indexes(start, end - 3600), rainfall = indexes(start + 3600, end);
  const highs = [], lows = [], totals = [];
  for (const key of Object.keys(h).filter(k => k.startsWith('temperature_2m_'))) {
    if (units[key] !== (metric ? '°C' : '°F') || !temperature.length) continue;
    const values = temperature.map(i => h[key]?.[i]);
    if (values.every(Number.isFinite)) { highs.push(Math.max(...values)); lows.push(Math.min(...values)); }
  }
  for (const key of Object.keys(h).filter(k => k.startsWith('precipitation_'))) {
    if (units[key] !== (metric ? 'mm' : 'inch') || !rainfall.length) continue;
    const values = rainfall.map(i => h[key]?.[i]);
    if (values.every(v => Number.isFinite(v) && v >= 0)) totals.push(values.reduce((a, b) => a + b, 0));
  }
  const range = values => values.length >= 2 ? { min: Math.min(...values), max: Math.max(...values), models: values.length } : null;
  const high = range(highs), low = range(lows), rain = range(totals);
  if (!high && !rain) return unavailable('Not enough complete model forecasts for this day. Comparison currently covers the next three days.');
  return { available: true, high, low, rain, fetchedAt: data._fetchedAt };
}

export function dayForecastRange(start, end) {
  return modelDayRange(modelContext === cacheContext('forecast') ? models : null, start, end, settings().units === 'metric');
}

async function ensureForecastModels() {
  const location = coords();
  if (!Number.isFinite(location.lat) || !Number.isFinite(location.lon)) return;
  const key = cacheContext('forecast');
  const age = Date.now() / 1000 - models?._fetchedAt;
  if (modelContext === key && age >= 0 && age <= MODEL_MAX_AGE) return;
  if (modelRequest && requestContext === key) return modelRequest;
  requestContext = key;
  const request = multiModel().then(result => {
    if (key !== cacheContext('forecast')) return;
    models = { ...result, _fetchedAt: Date.now() / 1000 };
    modelContext = key;
  }).catch(() => {}).finally(() => { if (modelRequest === request) modelRequest = null; });
  modelRequest = request;
  return request;
}

function rangeText(range) {
  if (!range.available) return range.reason;
  const parts = [];
  if (range.high) parts.push(`High ${num(range.high.min)}–${num(range.high.max)}${U.temp()} · low ${num(range.low.min)}–${num(range.low.max)}${U.temp()} (${range.high.models} models)`);
  if (range.rain) parts.push(`Precipitation ${num(range.rain.min, 2)}–${num(range.rain.max, 2)} ${U.precip()} water equivalent (${range.rain.models} models)`);
  else parts.push('Full-day precipitation comparison unavailable');
  return `${parts.join('. ')}. Open-Meteo model spread, not a probability range or a guarantee. Retrieved ${new Date(range.fetchedAt * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`;
}

export async function renderDayForecastRange(host, start, end) {
  const context = cacheContext('forecast'), selected = `${context}:${start}:${end}`;
  host.dataset.rangeSelection = selected;
  host.classList.add('fd-note');
  host.textContent = 'Loading model comparison…';
  await ensureForecastModels();
  if (context !== cacheContext('forecast') || host.dataset.rangeSelection !== selected) return;
  host.textContent = rangeText(dayForecastRange(start, end));
}

export function forecastCalendarDate(fc, dayStart) {
  if (!Number.isFinite(dayStart)) return null;
  if (fc?.timezone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: fc.timezone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(dayStart * 1000));
      const value = name => Number(parts.find(p => p.type === name)?.value);
      return new Date(value('year'), value('month') - 1, value('day'), 12);
    } catch { /* use the provider offset if available */ }
  }
  if (!Number.isFinite(fc?.utc_offset_seconds)) return null;
  const local = new Date((dayStart + fc.utc_offset_seconds) * 1000);
  return new Date(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 12);
}

export function normalComparison(day, normal) {
  if (!Number.isFinite(day?.air_temp_high) || !Number.isFinite(day?.air_temp_low)
      || !Number.isFinite(normal?.hi) || !Number.isFinite(normal?.lo)) return null;
  return { high: day.air_temp_high - normal.hi, low: day.air_temp_low - normal.lo };
}

export function initForecastInsights(host) {
  if (!host || host.dataset.insightsReady) return;
  host.dataset.insightsReady = 'true';
  host.classList.add('fd-context-grid');
  const node = (tag, text, parent, className) => {
    const el = document.createElement(tag);
    if (text) el.textContent = text;
    if (className) el.className = className;
    parent.append(el);
    return el;
  };
  const change = node('div', '', host, 'fd-context-item');
  node('strong', 'Forecast changes', change);
  const changeText = node('p', '', change, 'fd-note');
  const climate = node('details', '', host, 'fd-context-item');
  node('summary', 'Compared with normal', climate);
  const climateText = node('p', 'Open to compare today’s forecast with the local climate baseline.', climate, 'fd-note');
  const monthlyText = node('p', '', climate, 'fd-note');
  const source = node('a', 'About the 1991–2020 modeled baseline ↗', climate, 'fd-note');
  source.href = 'https://open-meteo.com/en/docs/historical-weather-api';
  source.target = '_blank'; source.rel = 'noopener noreferrer';
  let current = forecast(), currentContext = cacheContext('forecast'), generation = 0;
  const climateVisible = () => climate.open && !document.hidden && host.getClientRects().length > 0;
  const renderClimate = async () => {
    if (!climateVisible()) return;
    const at = ++generation, key = cacheContext('forecast');
    if (!current || current._cached) { climateText.textContent = 'A fresh forecast is needed for this comparison.'; monthlyText.textContent = ''; return; }
    const now = Date.now() / 1000, days = current.forecast?.daily || [];
    const today = days.find((d, i) => d.day_start_local <= now && now < (days[i + 1]?.day_start_local ?? d.day_start_local + 86400));
    const date = forecastCalendarDate(current, today?.day_start_local);
    if (!date) { climateText.textContent = 'A forecast with the location’s calendar date is needed for this comparison.'; monthlyText.textContent = ''; return; }
    climateText.textContent = 'Loading local climate baseline…';
    monthlyText.textContent = 'Loading monthly precipitation comparison…';
    const [normal, monthly] = await Promise.all([normalToday(date).catch(() => null), monthlyPrecipNormal(date).catch(() => null)]);
    if (at !== generation || key !== cacheContext('forecast') || !climateVisible()) return;
    const compared = normalComparison(today, normal);
    if (!compared) climateText.textContent = 'Temperature comparison unavailable for this location and day. Close and reopen to retry.';
    const difference = value => Math.abs(value) < 0.5 ? 'near normal' : `${num(Math.abs(value))}° ${value > 0 ? 'above' : 'below'} normal`;
    if (compared) climateText.textContent = `Today’s forecast high ${num(today.air_temp_high)}${U.temp()} is ${difference(compared.high)}; low ${num(today.air_temp_low)}${U.temp()} is ${difference(compared.low)}. Baseline high ${num(normal.hi)}${U.temp()} / low ${num(normal.lo)}${U.temp()}. Open-Meteo ERA5 1991–2020 modeled daily averages; not station records.`;
    if (!monthly) monthlyText.textContent = 'Monthly precipitation comparison unavailable: collecting complete archive days and baseline coverage. Missing days are not treated as dry.';
    else {
      const delta = monthly.total - monthly.normal;
      const difference = Math.abs(delta) < 0.005 ? 'at normal' : `${num(Math.abs(delta), 2)} ${U.precip()} ${delta > 0 ? 'above' : 'below'} normal`;
      monthlyText.textContent = `Monthly precipitation · ${monthly.start} to ${monthly.end}: modeled ${num(monthly.total, 2)} ${U.precip()} vs normal ${num(monthly.normal, 2)} ${U.precip()} (${difference}). ${monthly.days} complete days compared with the same calendar days in 1991–2020. ${monthly.currentMonth ? 'Current day excluded.' : 'Latest complete month available; recent archive data is delayed.'} ERA5 modeled water equivalent, including snow; not station observations.`;
    }
  };
  const render = () => {
    if (!current || current._cached) changeText.textContent = 'Waiting for a fresh forecast; saved weather is not compared.';
    else {
      snapshot(current);
      const result = changes(current, 0);
      if (result.age == null) changeText.textContent = 'Collecting a previous forecast for this location. Check again after the next refresh.';
      else {
        const when = new Date(result.base).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        const brief = result.items.slice(0, 2).map(item => `${item.day}: ${item.text}`).join(' · ');
        changeText.textContent = `${brief || 'No notable changes'}${result.items.length > 2 ? ` · ${result.items.length - 2} more changed days` : ''}. Compared with saved forecast ${when}.`;
      }
    }
    renderClimate();
  };
  climate.addEventListener('toggle', renderClimate);
  document.addEventListener('visibilitychange', renderClimate);
  window.addEventListener('wd:section', renderClimate);
  window.addEventListener('wd:forecast', e => { current = e.detail; currentContext = cacheContext('forecast'); render(); });
  window.addEventListener('wd:settings', () => {
    if (currentContext === cacheContext('forecast')) { renderClimate(); return; }
    currentContext = cacheContext('forecast'); current = null; generation++; render();
  });
  render();
}

window.addEventListener('wd:models', e => {
  models = e.detail;
  modelContext = cacheContext('forecast');
});
