import { settings, num, U, deg2compass, timeStr } from './app.js';
import { forecast, cacheContext } from './desk.js';
import { wx } from './icons.js';
import { initBalancedDesk } from './balanced-desk.js';
import { initForecastEnvironment } from './forecast-environment.js';
import { initForecastInsights } from './forecast-insights.js';

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

// Break a line at missing readings instead of drawing through unknown weather.
export function hourlyTrend(hours) {
  const values = hours.flatMap(h => [h.air_temperature, h.feels_like]).filter(Number.isFinite);
  if (!values.length) return null;
  const low = Math.floor(Math.min(...values) - 2), high = Math.ceil(Math.max(...values) + 2);
  const path = key => {
    let connected = false;
    return hours.map((h, i) => {
      if (!Number.isFinite(h[key])) { connected = false; return ''; }
      const point = `${(40 + i * 740 / Math.max(1, hours.length - 1)).toFixed(1)},${(52 - (h[key] - low) * 42 / (high - low)).toFixed(1)}`;
      const segment = `${connected ? 'L' : 'M'}${point}`; connected = true; return segment;
    }).join(' ');
  };
  return {low, high, temperature:path('air_temperature'), feels:path('feels_like')};
}

export function hourlyWeather(fc, tomorrow = false, now = Date.now() / 1000) {
  const days = fc?.forecast?.daily || [];
  const today = days.findIndex((d, i) => d.day_start_local <= now && (days[i + 1]?.day_start_local ?? d.day_start_local + 86400) > now);
  const start = tomorrow ? days[today + 1]?.day_start_local : now;
  const end = tomorrow ? days[today + 2]?.day_start_local ?? start + 86400 : now + 86400;
  if (!Number.isFinite(start) || tomorrow && today < 0) return { rows: [], total: null };
  const hours = [...new Map((fc?.forecast?.hourly || [])
    .filter(h => Number.isFinite(h.time) && h.time > start && h.time <= end)
    .map(h => [h.time, h])).values()].sort((a, b) => a.time - b.time);
  let sum = 0, complete = true;
  const rows = hours.map((h, i) => {
    const known = h.precip_period === 'preceding-hour' && Number.isFinite(h.precip) && h.precip >= 0;
    if (!known || i && h.time - hours[i - 1].time !== 3600) complete = false;
    if (known) sum += h.precip;
    return { ...h, amount: known ? h.precip : null, accumulated: complete ? sum : null };
  });
  const visibility = hours.filter(h => Number.isFinite(h.visibility) && h.visibility >= 0);
  const low = visibility.find(h => h.visibility < 1609.344);
  // A missing hour cannot establish when low visibility clears.
  let recovery = null;
  if (low) {
    for (let i = hours.indexOf(low) + 1; i < hours.length; i++) {
      if (hours[i].time - hours[i - 1].time !== 3600 || !Number.isFinite(hours[i].visibility)) break;
      if (hours[i].visibility >= 1609.344) { recovery = hours[i]; break; }
    }
  }
  const peak = rows.filter(h => h.amount > 0).reduce((best, h) => !best || h.amount > best.amount ? h : best, null);
  const expected = tomorrow ? (end - start) / 3600 : 24;
  return { rows, total: complete && rows.length === expected ? sum : null, peak, low, recovery,
    minimumVisibility: visibility.length ? Math.min(...visibility.map(h => h.visibility)) : null };
}

export function precipitationOutlook(fc, now = Date.now() / 1000) {
  const hours = (fc?.forecast?.hourly || []).filter(h => h.time >= now && h.time < now + 48 * 3600);
  const next = hours.find(h => Number.isFinite(h.precip_probability) && h.precip_probability >= 20);
  const known = hours.filter(h => Number.isFinite(h.precip_probability));
  return { next, low: hours.length > 0 && known.length === hours.length && !next,
    days: (fc?.forecast?.daily || []).filter(d => d.day_start_local > now).slice(0, 2) };
}

// Fill only gaps in the primary forecast, matching timestamps rather than array positions.
export function withForecastContext(base, model) {
  if (!base || !model) return base;
  const current = {...base.current_conditions};
  for (const key of ['visibility','cloud_cover','cloud_base_estimate','freezing_level'])
    if (!Number.isFinite(current[key])) current[key] = model.current_conditions?.[key];
  const modelHours = new Map((model.forecast?.hourly || []).map(h => [h.time, h]));
  const modelDays = new Map((model.forecast?.daily || []).map(d => [d.day_start_local, d]));
  return {...base, current_conditions:current, forecast:{...base.forecast,
    hourly:(base.forecast?.hourly || []).map(h => {
      const hour = {...h}, extra = modelHours.get(h.time);
      for (const key of ['cloud_cover','feels_like','visibility','wet_bulb_temperature','freezing_level'])
        if (!Number.isFinite(hour[key])) hour[key] = extra?.[key];
      // Use a known accumulation interval when the primary provider does not specify one.
      if ((!Number.isFinite(hour.precip) || hour.precip_period !== 'preceding-hour') && Number.isFinite(extra?.precip)) {
        hour.precip = extra.precip; hour.precip_period = extra.precip_period; hour.precip_source = extra.precip_source;
      }
      return hour;
    }),
    daily:(base.forecast?.daily || []).map(d => Number.isFinite(d.precip_accum) ? d : {...d,
      precip_accum:modelDays.get(d.day_start_local)?.precip_accum, _amountSource:'Open-Meteo'})
  }};
}

const $ = id => document.getElementById(id);
const node = (tag, className, text) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
};
const icon = key => { const el = node('span', 'fd-icon'); el.setAttribute('aria-hidden', 'true'); el.innerHTML = wx(key, 58, true); return el; };
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
  const chart = node('div'); chart.className = 'fd-trend'; hourly.append(chart);
  const table = node('div', 'fd-hour-grid'); hourly.append(table);
  const detail = node('div', 'fd-hour-detail'); detail.setAttribute('aria-live', 'polite'); hourly.append(detail);
  const timeline = node('details', 'fd-hour-timeline');
  const timelineSummary = node('summary', '', 'Precipitation & visibility · every hour');
  const timelineLead = node('p', 'fd-note');
  const timelineBody = node('div', 'fd-table-scroll');
  timeline.append(timelineSummary, timelineLead, timelineBody); hourly.append(timeline);
  timeline.addEventListener('toggle', () => { if (timeline.open) renderTimeline(); });
  const insights = node('div'); insights.id = 'forecast-insights';
  $('observatory-forecast').append(insights); initForecastInsights(insights);
  const precip = panel('forecast-precip', 'Precipitation outlook', sidebar);
  const precipBody = node('div'); precip.append(precipBody);
  sidebar.append($('outlook-astronomy'));
  const hazards = panel('forecast-hazards', 'Local hazard outlooks', sidebar);

  const atmosphere = panel('forecast-atmosphere', 'Atmosphere', sidebar);
  const airBody = node('div', 'fd-air-grid'); atmosphere.append(airBody);
  const sourceNote = node('p', 'fd-note'); atmosphere.append(sourceNote);
  const environment = panel('forecast-environment', 'Ground & nearby sky', sidebar);
  initForecastEnvironment(environment);
  const balanced = initBalancedDesk();
  let supplemental = null;
  let fc = forecast(), context = cacheContext('forecast'), tomorrow = false, selected = null;
  const narrow = matchMedia('(max-width: 1100px)');
  const value = (label, reading, hint) => {
    const box = node('div'); box.append(node('span', 'fd-note', label), node('strong', '', reading));
    if (hint) box.append(node('small', 'fd-note', hint)); return box;
  };
  const distance = n => Number.isFinite(n) && n >= 0 ? `${num(n / (settings().units === 'metric' ? 1000 : 1609.344), 1)} ${settings().units === 'metric' ? 'km' : 'mi'}` : '—';
  function renderTimeline() {
    if (!timeline.open) return;
    const outlook = hourlyWeather(withForecastContext(fc, supplemental), tomorrow);
    timelineBody.replaceChildren();
    timelineLead.textContent = 'Precipitation is the water-equivalent total of rain, showers and snow for the hour ending at the listed time; running totals start with the first listed hour. Visibility is a model estimate at that time, not an observed fog report. Device local time.';
    if (!outlook.rows.length) { timelineBody.append(node('p', 'fd-note', 'Hourly detail unavailable for this period.')); return; }
    const grid = node('table', 'fd-weather-table');
    const caption = node('caption', 'fd-note', tomorrow ? 'Tomorrow · hourly forecast' : 'Next 24 hours · hourly forecast');
    const head = node('thead'), heading = node('tr');
    for (const label of ['Hour ending', `Precipitation · ${U.precip()}`, `Running total · ${U.precip()}`, 'Visibility']) {
      const th = node('th', '', label); th.scope = 'col'; heading.append(th);
    }
    head.append(heading); grid.append(caption, head);
    const body = node('tbody');
    for (const h of outlook.rows) {
      const row = node('tr'), when = node('th', '', new Date(h.time * 1000).toLocaleString([], {weekday:'short',hour:'numeric',minute:'2-digit'}));
      when.scope = 'row'; row.append(when);
      for (const text of [num(h.amount, 2), num(h.accumulated, 2), distance(h.visibility)]) row.append(node('td', '', text));
      if (h.visibility != null && h.visibility < 1609.344) row.className = 'fd-low-visibility';
      body.append(row);
    }
    grid.append(body); timelineBody.append(grid);
    const sources = [...new Set(outlook.rows.map(h => h.precip_source).filter(Boolean))];
    timelineBody.append(node('p', 'fd-note', `Source: ${sources.join(' / ') || 'forecast provider'}. — means unavailable or an incomplete accumulation period.`));
  }
  function renderHourly() {
    const combined = withForecastContext(fc, supplemental);
    const hours = forecastHours(combined, tomorrow, narrow.matches ? 4 : 8);
    const outlook = hourlyWeather(combined, tomorrow);
    const summary = [];
    if (outlook.total != null) summary.push(`${num(outlook.total, 2)} ${U.precip()} total`);
    if (outlook.peak) summary.push(`heaviest hour ending ${time(outlook.peak.time)}`);
    if (outlook.low) summary.push(`visibility below ${distance(1609.344)} at ${time(outlook.low.time)}${outlook.recovery ? `, improving at ${time(outlook.recovery.time)}` : ''}`);
    timelineSummary.textContent = 'Precipitation & visibility · every hour' + (summary.length ? ' · ' + summary.join(' · ') : '');
    renderTimeline();
    buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(tomorrow === !!i)));
    note.textContent = `${fc?._cached ? 'Saved forecast' : 'Forecast'} · ${narrow.matches ? 6 : 3}-hour steps · device local time`;
    table.replaceChildren(); detail.replaceChildren();
    chart.replaceChildren();
    const trend = hourlyTrend(hours);
    if (trend) {
      const key = node('div', 'fd-chart-key'); key.append(node('span', '', `— Temperature ${U.temp()}`), node('span', '', '┄ Feels like'));
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'fd-hour-chart'); svg.setAttribute('viewBox', '0 0 800 60'); svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `Hourly temperature and feels-like trend. Scale ${trend.low} to ${trend.high} ${U.temp()}. Select an hour below for values.`);
      for (const key of ['temperature', 'feels']) {
        const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('class', key); path.setAttribute('d', trend[key]); svg.append(path);
      }
      for (const [label, y] of [[trend.high,14],[trend.low,54]]) {
        const text = document.createElementNS(svg.namespaceURI, 'text'); text.setAttribute('x','0'); text.setAttribute('y',String(y)); text.textContent = label + '°'; svg.append(text);
      }
      chart.append(key, svg);
    }
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
        const cell = node('div', `fd-hour-cell${h.time === selected ? ' selected' : ''}`, key === 'precip_probability' ? chance(h[key]) : key === 'visibility' ? distance(h[key]) : key === 'precip' ? num(h.precip_period === 'preceding-hour' ? h[key] : null, 2) : num(h[key]));
        if (key === 'precip') cell.title = `Amount for the hour ending ${time(h.time)} · ${h.precip_source || 'interval unavailable'}`;
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
    const combined = withForecastContext(fc, supplemental);
    const outlook = precipitationOutlook(combined), c = combined?.current_conditions || {};
    sourceNote.textContent = supplemental ? 'Supplementary model estimates: Open-Meteo' : 'Availability depends on your forecast provider.';
    const lead = node('div', 'fd-precip-lead');
    if (outlook.next) {
      const d = outlook.next;
      lead.append(icon(d.icon), value('Next chance of precipitation', `${chance(d.precip_probability)} · ${time(d.time)}`, new Date(d.time * 1000).toLocaleDateString([], {weekday:'long',month:'short',day:'numeric'})));
    } else lead.append(value(outlook.low ? 'Low precipitation chances' : 'Precipitation timing unavailable', outlook.low ? 'Below 20%' : '—', outlook.low ? 'Across the available next 48 hours' : 'This provider has no hourly probability for this period'));
    precipBody.append(lead);
    const days = node('div', 'fd-rain-days');
    for (const d of outlook.days) days.append(value(new Date(d.day_start_local * 1000).toLocaleDateString([], {weekday:'short',month:'short',day:'numeric'}), `${num(d.precip_accum, 2)} ${U.precip()}`, `${chance(d.precip_probability)} chance · ${d._amountSource ? d._amountSource + ' ' : ''}forecast total`));
    precipBody.append(days);
    const metric = settings().units === 'metric';
    const height = n => Number.isFinite(n) ? `${num(n * (metric ? 1 : 3.28084))} ${metric ? 'm' : 'ft'}` : '—';
    airBody.append(value('Visibility', Number.isFinite(c.visibility) ? `${num(c.visibility / (metric ? 1000 : 1609.344), 1)} ${metric ? 'km' : 'mi'}` : '—', 'Forecast estimate'),
      value('Cloud cover', chance(c.cloud_cover), 'Forecast estimate'),
      value('Convective cloud base', height(c.cloud_base_estimate), 'Estimated above ground · not a ceiling'),
      value('Freezing level', height(c.freezing_level), 'Model altitude above sea level'));
    balanced.updateAtmosphere(c);
    atmosphere.title = 'Unavailable provider readings are shown as —. Cloud base is a temperature/dew-point approximation for convective clouds.';
  }
  let dirty = true;
  function requestRender() {
    dirty = true;
    if (document.hidden || !$('desk').classList.contains('active') || settings().deskRadar) return;
    dirty = false; render();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && dirty) requestRender(); });
  window.addEventListener('wd:section', () => { if (dirty) requestRender(); });
  window.addEventListener('wd:forecast-context', e => {
    if (e.detail.context !== cacheContext('forecast')) return;
    supplemental = e.detail.forecast; requestRender();
  });
  window.addEventListener('wd:forecast', e => { fc = e.detail; context = cacheContext('forecast'); requestRender(); });
  window.addEventListener('wd:settings', () => {
    if (context !== cacheContext('forecast')) { fc = null; supplemental = null; selected = null; context = cacheContext('forecast'); }
    requestRender();
  });
  narrow.addEventListener('change', requestRender);
  requestRender();
}
