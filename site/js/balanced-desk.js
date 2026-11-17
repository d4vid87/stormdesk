import { settings, coords, num, U, everyVisible, timeStr, windToMs } from './app.js';
import { cacheContext } from './desk.js';
import { soilForecast } from './api.js';
import { soilSnapshot } from './forecast-environment.js';
import { initForecastHazards } from './forecast-hazards.js';
import { winterOutlook } from './balanced-context.js';
import { weatherChanges } from './weather-changes.js';

const $ = id => document.getElementById(id);
const node = (tag, cls = '', text) => {
  const el = document.createElement(tag); el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};
const when = iso => iso ? new Date(iso).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : 'Unavailable';

// Keep the original live render targets: only their position changes when details open.
export function initBalancedDesk() {
  const desk = $('desk'), grid = $('observatory-grid');
  desk.classList.add('balanced-desk');
  grid.append($('observatory-forecast'), $('forecast-hourly'), $('forecast-sidebar'));
  const parking = node('div'); parking.id = 'balanced-details'; parking.hidden = true; desk.append(parking);
  const sources = ['forecast-hazards', 'forecast-atmosphere', 'forecast-environment', 'forecast-insights'].map($);
  const timeline = desk.querySelector('.fd-hour-timeline'), sky = desk.querySelector('.sky-details');
  parking.append(...sources, timeline, sky);

  const dialog = node('dialog'); dialog.id = 'balanced-dialog'; dialog.setAttribute('aria-labelledby', 'balanced-detail-title');
  const title = node('h2'); title.id = 'balanced-detail-title';
  const close = node('button', 'balanced-close', 'Close'); close.type = 'button'; close.autofocus = true;
  close.setAttribute('aria-label', 'Close details'); close.onclick = () => dialog.close();
  const body = node('div'); body.id = 'balanced-detail-body'; dialog.append(close, title, body); desk.append(dialog);
  let moved = [], opener;
  const restore = () => {
    for (const {el, parent, next, hidden, open} of moved) {
      parent.insertBefore(el, next?.parentNode === parent ? next : null); el.hidden = hidden;
      for (const detail of el.querySelectorAll('details[open]')) detail.open = false;
      if (el.tagName === 'DETAILS') el.open = open;
    }
    moved = []; body.replaceChildren(); opener?.focus({preventScroll:true});
  };
  dialog.addEventListener('close', () => { if (!dialog.open) restore(); });
  const open = (label, nodes, trigger) => {
    if (dialog.open) dialog.close();
    // Native close events are queued; restore the previous sources before opening another detail.
    restore();
    opener = trigger; title.textContent = label;
    moved = nodes.filter(Boolean).map(el => ({el, parent:el.parentNode, next:el.nextSibling, hidden:el.hidden, open:el.open}));
    for (const {el} of moved) { body.append(el); el.hidden = false; }
    dialog.showModal();
    for (const {el} of moved) if (el.tagName === 'DETAILS') el.open = true;
  };
  const button = (parent, label, nodes) => {
    const b = node('button', 'balanced-detail-link', label); b.type = 'button';
    b.setAttribute('aria-haspopup', 'dialog'); b.onclick = () => open(label, nodes, b); parent.append(b); return b;
  };
  button($('observatory-forecast').querySelector('.forecast-heading'), 'Forecast changes & normals', [$('forecast-insights')]);
  button($('forecast-hourly'), 'Hourly detail', [timeline]);
  button($('outlook-astronomy'), 'Sun & moon details', [sky, desk.querySelector('.sky-footnote')]);
  window.addEventListener('wd:settings', () => { if (dialog.open) dialog.close(); });
  window.addEventListener('wd:section', () => { if (dialog.open) dialog.close(); });

  const contexts = node('div'); contexts.id = 'balanced-contexts'; grid.append(contexts);
  function card(id, title, label, nodes) {
    const box = node('section', 'fd-panel balanced-card'); box.id = id;
    const heading = node('h2', '', title); heading.id = `${id}-title`; box.setAttribute('aria-labelledby', heading.id);
    const shapes = {
      'balanced-hazards':'<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3v.1"/>',
      'balanced-air':'<path d="M20 3C10 3 3 7 4 14c1 7 13 10 16-11Z"/><path d="M4 21 15 10"/>',
      'balanced-changes':'<path d="M5 16V5a3 3 0 0 1 6 0v11a5 5 0 1 1-6 0ZM8 9v10M16 8h6m-3-3 3 3-3 3M22 17h-6m3-3-3 3 3 3"/>',
      'balanced-winter':'<path d="M12 2v20M3.34 7l17.32 10M3.34 17 20.66 7M9 4l3 3 3-3M9 20l3-3 3 3M3.6 10.6l4.1-1.1-1.1-4.1M20.4 13.4l-4.1 1.1 1.1 4.1M6.6 18.6l1.1-4.1-4.1-1.1M17.4 5.4l-1.1 4.1 4.1 1.1"/>',
    };
    const icon = node('span', 'balanced-symbol'); icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" focusable="false">${shapes[id]}</svg>`;
    heading.prepend(icon);
    const main = node('strong', 'balanced-reading', 'Loading…'), summary = node('p', 'balanced-summary', 'Waiting for current data');
    box.append(heading, main, summary); button(box, label, nodes); contexts.append(box);
    return {box, main, summary};
  }
  const hazard = card('balanced-hazards', 'Hazards & atmosphere', 'Hazards & atmosphere details', [$('forecast-hazards'), $('forecast-atmosphere')]);
  const air = card('balanced-air', 'Air & ground', 'Air & ground details', [$('signal-details').querySelector('[data-panel="aqi"]'), $('forecast-environment')]);
  const changeBody = node('section'), winterBody = node('section'); parking.append(changeBody, winterBody);
  changeBody.id = 'weather-change-details';
  const change = card('balanced-changes', 'Weather changes', 'Upcoming weather changes', [changeBody]);
  const changeTimeline = node('div', 'change-timeline'); change.box.insertBefore(changeTimeline, change.box.lastElementChild);
  const winter = card('balanced-winter', 'Winter impact', 'Winter impact details', [winterBody]);
  let atmosphereText = 'Atmosphere unavailable', hazardLabels = {rain:'Loading…', heat:'Loading…', severe:'Loading…'};
  function renderHazards() {
    hazard.main.textContent = `Flash flood · ${hazardLabels.rain}`;
    hazard.summary.textContent = `HeatRisk: ${hazardLabels.heat} · Severe: ${hazardLabels.severe}. ${atmosphereText}`;
  }
  initForecastHazards($('forecast-hazards'), labels => { hazardLabels = labels; renderHazards(); }, hazard.box);
  let soil = null;
  function renderAir() {
    const source = $('aqi-val'), raw = source.textContent.trim(), aqi = Number(raw), stale = source.classList.contains('stale');
    const known = !stale && raw !== '' && Number.isFinite(aqi) && aqi >= 0;
    air.main.textContent = stale ? 'Air quality outdated' : known ? `AQI ${num(aqi)} · ${$('aqi-label').textContent}` : 'Air quality unavailable';
    air.summary.textContent = `${known ? $('aqi-detail').textContent + ' · ' : ''}Soil 6 cm: ${soil && !soil.stale ? num(soil.temperature6) + U.temp() : '—'} · Moisture 3–9 cm: ${soil && !soil.stale ? num(soil.moisture3to9) + '%' : '—'} · Model estimates`;
  }
  new MutationObserver(renderAir).observe($('aqi-val').parentElement, {subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:['class', 'data-ts']});
  renderAir();
  function renderProvider(card, target, result) {
    card.main.textContent = result.label; card.box.dataset.status = result.status;
    card.summary.textContent = result.summary;
    target.replaceChildren(node('p', '', result.summary));
    if (result.issuedTime) target.append(node('p', 'fd-note', `Issued ${when(result.issuedTime)} · valid through ${when(result.validUntil)} · device local time`));
    if (result.validFrom) target.append(node('p', '', `Valid from ${when(result.validFrom)}. This is planning guidance, not a warning.`));
    const link = node('a', 'balanced-source', `Open ${result.source} ↗`); link.href = result.sourceUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; target.append(link);
    if (result.status === 'configure') {
      const configure = node('button', 'balanced-detail-link', 'Open Settings'); configure.type = 'button';
      configure.onclick = () => { dialog.close(); $('btn-settings').click(); }; target.append(configure);
    }
  }
  let generation = 0;
  const contextKey = () => cacheContext('forecast');
  let context = contextKey();
  function schedule() {
    const version = ++generation;
    everyVisible('balanced-winter', 1800, winter.box, async () => {
      const result = await winterOutlook(); if (version === generation) renderProvider(winter, winterBody, result);
    });
    everyVisible('balanced-soil', 1800, air.box, async () => {
      const c = coords(); if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) return;
      try {
        const result = soilSnapshot(await soilForecast(), settings().units === 'metric');
        if (version === generation) { soil = result; renderAir(); }
      } catch { if (version === generation) { soil = null; renderAir(); } }
    });
  }
  schedule();
  window.addEventListener('wd:settings', () => {
    if (context === contextKey()) return;
    context = contextKey(); soil = null; renderAir(); atmosphereText = 'Atmosphere unavailable'; renderHazards();
    winter.main.textContent = 'Loading…'; winter.summary.textContent = 'Waiting for current data';
    winterBody.replaceChildren(); schedule();
  });
  return {
    updateWeatherChanges(fc) {
      const metric = settings().units === 'metric', outlook = weatherChanges(fc, metric);
      change.box.dataset.status = outlook.status;
      changeTimeline.replaceChildren(); changeBody.replaceChildren();
      const {temperature, wind, cloud} = outlook;
      if (outlook.status === 'unavailable') {
        change.main.textContent = 'Hourly changes unavailable';
        change.summary.textContent = 'Waiting for a current hourly forecast.';
        changeBody.append(node('p', '', 'There is not enough current hourly forecast data to compare upcoming conditions.'));
        return;
      }
      const temperatureHeadline = temperature && `${num(Math.abs(temperature.delta))}° ${temperature.delta < 0 ? 'cooler' : 'warmer'} by ${timeStr(temperature.end.time)}`;
      const windHeadline = wind && `Gusts reach ${num(wind.end.wind_gust)} ${U.wind()} by ${timeStr(wind.end.time)}`;
      const cloudHeadline = cloud && `Clouds ${cloud.delta > 0 ? 'increase' : 'decrease'} by ${timeStr(cloud.end.time)}`;
      change.main.textContent = temperature?.significant ? temperatureHeadline
        : wind && windToMs(wind.delta) >= 4.5 ? windHeadline
        : cloud && Math.abs(cloud.delta) >= 30 ? cloudHeadline
        : temperature && Math.abs(temperature.delta) >= 1 ? temperatureHeadline
        : temperature && outlook.complete ? 'Little temperature change' : wind ? windHeadline : cloud && Math.abs(cloud.delta) >= 1 ? cloudHeadline : 'Hourly comparison limited';
      change.summary.textContent = `${fc?._cached ? 'Saved forecast' : 'Forecast'} · ${outlook.complete ? 'next 12 hours' : 'partial coverage'}`;
      for (const h of outlook.samples) {
        const point = node('div'), label = node('time', '', timeStr(h.time)); label.dateTime = new Date(h.time * 1000).toISOString();
        point.append(label, node('strong', '', Number.isFinite(h.air_temperature) ? `${num(h.air_temperature)}°` : '—')); changeTimeline.append(point);
      }
      changeBody.append(node('h3', '', change.main.textContent), node('p', 'fd-note', `${change.summary.textContent}. Changes compare forecast hours, not station observations. Times follow this device.`));
      if (temperature) changeBody.append(node('p', '', `Temperature: ${num(temperature.start.air_temperature)}${U.temp()} at ${timeStr(temperature.start.time)} → ${num(temperature.end.air_temperature)}${U.temp()} at ${timeStr(temperature.end.time)}.`));
      if (wind) changeBody.append(node('p', '', `Forecast gusts: ${num(wind.start.wind_gust)} → ${num(wind.end.wind_gust)} ${U.wind()} by ${timeStr(wind.end.time)}.`));
      if (cloud) changeBody.append(node('p', '', `Cloud cover: ${num(cloud.start.cloud_cover)}% → ${num(cloud.end.cloud_cover)}% by ${timeStr(cloud.end.time)}.`));
      const table = node('table', 'fd-weather-table'), header = node('thead'), row = node('tr'), rows = node('tbody');
      for (const label of ['Forecast hour', `Temperature ${U.temp()}`, `Gusts ${U.wind()}`, 'Cloud cover']) { const th = node('th', '', label); th.scope = 'col'; row.append(th); }
      header.append(row);
      for (const h of outlook.hours) {
        const tr = node('tr'), th = node('th', '', when(h.time * 1000)); th.scope = 'row'; tr.append(th);
        for (const reading of [Number.isFinite(h.air_temperature) ? num(h.air_temperature) : '—', Number.isFinite(h.wind_gust) && h.wind_gust >= 0 ? num(h.wind_gust) : '—', Number.isFinite(h.cloud_cover) && h.cloud_cover >= 0 && h.cloud_cover <= 100 ? `${num(h.cloud_cover)}%` : '—']) tr.append(node('td', '', reading));
        rows.append(tr);
      }
      table.append(header, rows); const scroll = node('div', 'fd-table-scroll'); scroll.append(table); changeBody.append(scroll);
      changeBody.append(node('p', 'fd-note', `Source: ${fc?._forecastSource || fc?._provider || 'your selected forecast provider'}.${fc?._cached && Number.isFinite(fc._savedAt) ? ` Saved ${when(fc._savedAt)}.` : ''} Missing readings are shown as —.`));
    },
    updateAtmosphere(c = {}) {
      const metric = settings().units === 'metric';
      atmosphereText = `Visibility ${Number.isFinite(c.visibility) ? num(c.visibility / (metric ? 1000 : 1609.344), 1) + (metric ? ' km' : ' mi') : '—'} · Cloud base ${Number.isFinite(c.cloud_base_estimate) ? num(c.cloud_base_estimate * (metric ? 1 : 3.28084)) + (metric ? ' m' : ' ft') : '—'} (model estimates)`;
      renderHazards();
    },
  };
}
