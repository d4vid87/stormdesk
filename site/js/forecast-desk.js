import { settings, num, U, deg2compass, timeStr } from './app.js';
import { forecast, cacheContext } from './desk.js';
import { wx } from './icons.js';

// Daily boundaries come from the provider, including 23/25-hour daylight-saving days.
export function forecastHours(fc, tomorrow = false, count = 8, now = Date.now() / 1000) {
  const days = fc?.forecast?.daily || [];
  const today = days.findIndex((d, i) => d.day_start_local <= now && (days[i + 1]?.day_start_local ?? d.day_start_local + 86400) > now);
  const start = tomorrow ? days[today + 1]?.day_start_local : now - 3600;
  const end = tomorrow ? days[today + 2]?.day_start_local ?? start + 86400 : now + 24 * 3600;
  if (tomorrow && today < 0 || !Number.isFinite(start)) return [];
  const hours = (fc?.forecast?.hourly || []).filter(h => Number.isFinite(h.time) && (tomorrow ? h.time >= start : h.time > start) && h.time < end);
  const step = 24 * 3600 / count;
  return hours.filter(h => (h.time - (hours[0]?.time || 0)) % step < 3600).slice(0, count);
}

export function precipitationOutlook(fc, now = Date.now() / 1000) {
  const hours = (fc?.forecast?.hourly || []).filter(h => h.time >= now && h.time < now + 48 * 3600);
  const next = hours.find(h => Number.isFinite(h.precip_probability) && h.precip_probability >= 20);
  const known = hours.filter(h => Number.isFinite(h.precip_probability));
  return { next, low: hours.length > 0 && known.length === hours.length && !next,
    days: (fc?.forecast?.daily || []).filter(d => d.day_start_local > now).slice(0, 2) };
}

const $ = id => document.getElementById(id);
const node = (tag, className, text) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
};
const icon = key => { const el = node('span', 'fd-icon'); el.setAttribute('aria-hidden', 'true'); el.innerHTML = wx(key, 58); return el; };
const time = timeStr;
const chance = n => Number.isFinite(n) ? `${num(n)}%` : '—';

export function initForecastDesk() {
  if ($('forecast-sidebar')) return;
  const head = $('observatory-heading'), conditions = node('div', 'forecast-conditions');
  conditions.append(head.querySelector('.observatory-place'), $('hero'));
  head.prepend(conditions);
  const clock = head.querySelector('.observatory-clock');
  clock.firstElementChild.id = 'clock-zone';
  $('hero-clock').setAttribute('role', 'timer');
  $('hero-clock').setAttribute('aria-live', 'off');
  const title = node('h2', 'fd-gauge-title', 'Current readings');
  $('radar-shelf').prepend(title);

  const sidebar = node('aside'); sidebar.id = 'forecast-sidebar';
  sidebar.setAttribute('aria-label', 'Sky and atmosphere');
  sidebar.append($('outlook-astronomy'));
  $('observatory-grid').append(sidebar);
  const panel = (id, title, parent) => {
    const box = node('section', 'fd-panel'); box.id = id;
    const h = node('h2', '', title); h.id = `${id}-title`;
    box.setAttribute('aria-labelledby', h.id); box.append(h); parent.append(box); return box;
  };
  const hourly = panel('forecast-hourly', 'Hourly outlook', $('observatory-left'));
  const controls = node('div', 'fd-periods'); controls.setAttribute('role', 'group'); controls.setAttribute('aria-label', 'Hourly forecast period');
  const buttons = ['Next 24h', 'Tomorrow'].map((label, i) => {
    const b = node('button', '', label); b.type = 'button'; b.onclick = () => { tomorrow = !!i; selected = null; renderHourly(); }; controls.append(b); return b;
  });
  hourly.append(controls);
  const note = node('p', 'fd-note'); hourly.append(note);
  const table = node('div', 'fd-hour-grid'); hourly.append(table);
  const detail = node('div', 'fd-hour-detail'); detail.setAttribute('aria-live', 'polite'); hourly.append(detail);
  const precip = panel('forecast-precip', 'Precipitation outlook', sidebar);
  const precipBody = node('div'); precip.append(precipBody);
  const atmosphere = panel('forecast-atmosphere', 'Atmosphere', sidebar);
  const airBody = node('div', 'fd-air-grid'); atmosphere.append(airBody);
  let fc = forecast(), context = cacheContext('forecast'), tomorrow = false, selected = null;
  const narrow = matchMedia('(max-width: 1100px)');
  const value = (label, reading, hint) => {
    const box = node('div'); box.append(node('span', 'fd-note', label), node('strong', '', reading));
    if (hint) box.append(node('small', 'fd-note', hint)); return box;
  };
  function renderHourly() {
    const hours = forecastHours(fc, tomorrow, narrow.matches ? 4 : 8);
    buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(tomorrow === !!i)));
    note.textContent = `${fc?._cached ? 'Saved forecast' : 'Forecast'} · ${narrow.matches ? 6 : 3}-hour steps · device local time`;
    table.replaceChildren(); detail.replaceChildren();
    if (!hours.length) { table.append(node('p', 'fd-note', 'Hourly forecast unavailable for this period.')); return; }
    const hour = hours.find(h => h.time === selected) || hours[0]; selected = hour.time;
    table.style.setProperty('--hours', hours.length);
    table.append(node('span', 'fd-hour-label', `Time / ${U.temp()}`));
    hours.forEach(h => {
      const b = node('button', 'fd-hour'); b.type = 'button';
      b.setAttribute('aria-pressed', String(h.time === selected));
      b.setAttribute('aria-label', `${time(h.time)}, ${h.conditions || 'Conditions unavailable'}, ${num(h.air_temperature)}${U.temp()}. Rain chance ${chance(h.precip_probability)}, wind ${num(h.wind_avg)} ${U.wind()}, gust ${num(h.wind_gust)} ${U.wind()}. Show details`);
      b.append(node('span', '', time(h.time)), icon(h.icon), node('strong', '', `${num(h.air_temperature)}°`));
      b.onclick = () => { selected = h.time; renderHourly(); table.querySelector('[aria-pressed="true"]')?.focus({preventScroll:true}); }; table.append(b);
    });
    for (const [label, key] of [['Rain chance', 'precip_probability'], [`Wind · ${U.wind()}`, 'wind_avg'], [`Gust · ${U.wind()}`, 'wind_gust']]) {
      table.append(node('span', 'fd-hour-label', label));
      hours.forEach(h => {
        const cell = node('div', `fd-hour-cell${h.time === selected ? ' selected' : ''}`, key === 'precip_probability' ? chance(h[key]) : num(h[key]));
        if (key === 'precip_probability' && Number.isFinite(h[key])) {
          const bar = node('i'); bar.style.width = `${Math.max(0, Math.min(100, h[key]))}%`; cell.append(bar);
        }
        table.append(cell);
      });
    }
    detail.append(node('p', 'fd-hour-summary', `${new Date(hour.time * 1000).toLocaleDateString([], {weekday:'short'})}, ${time(hour.time)} · ${hour.conditions || 'Conditions unavailable'}${Number.isFinite(hour.wind_direction) ? ` · ${deg2compass(hour.wind_direction)} wind` : ''}`));
    detail.append(value('Feels like', `${num(hour.feels_like)}°`), value('Humidity', chance(hour.relative_humidity)), value('Cloud cover', chance(hour.cloud_cover)), value('UV index', num(hour.uv)));
  }
  function render() {
    renderHourly();
    precipBody.replaceChildren(); airBody.replaceChildren();
    const outlook = precipitationOutlook(fc), c = fc?.current_conditions || {};
    const lead = node('div', 'fd-precip-lead');
    if (outlook.next) {
      const d = outlook.next;
      lead.append(icon(d.icon), value('Next chance of precipitation', `${chance(d.precip_probability)} · ${time(d.time)}`, new Date(d.time * 1000).toLocaleDateString([], {weekday:'long',month:'short',day:'numeric'})));
    } else lead.append(value(outlook.low ? 'Low precipitation chances' : 'Precipitation timing unavailable', outlook.low ? 'Below 20%' : '—', outlook.low ? 'Across the available next 48 hours' : 'This provider has no hourly probability for this period'));
    precipBody.append(lead);
    const days = node('div', 'fd-rain-days');
    for (const d of outlook.days) days.append(value(new Date(d.day_start_local * 1000).toLocaleDateString([], {weekday:'short',month:'short',day:'numeric'}), `${num(d.precip_accum, 2)} ${U.precip()}`, `${chance(d.precip_probability)} chance · forecast total`));
    precipBody.append(days);
    const metric = settings().units === 'metric';
    const height = n => Number.isFinite(n) ? `${num(n * (metric ? 1 : 3.28084))} ${metric ? 'm' : 'ft'}` : '—';
    airBody.append(value('Visibility', Number.isFinite(c.visibility) ? `${num(c.visibility / (metric ? 1000 : 1609.344), 1)} ${metric ? 'km' : 'mi'}` : '—', 'Forecast estimate'),
      value('Cloud cover', chance(c.cloud_cover), 'Forecast estimate'),
      value('Convective cloud base', height(c.cloud_base_estimate), 'Estimated above ground · not a ceiling'),
      value('Freezing level', height(c.freezing_level), 'Model altitude above sea level'));
    atmosphere.title = 'Unavailable provider readings are shown as —. Cloud base is a temperature/dew-point approximation for convective clouds.';
  }
  window.addEventListener('wd:forecast', e => { fc = e.detail; context = cacheContext('forecast'); render(); });
  window.addEventListener('wd:settings', () => {
    if (context !== cacheContext('forecast')) { fc = null; selected = null; context = cacheContext('forecast'); }
    render();
  });
  narrow.addEventListener('change', renderHourly);
  render();
}
