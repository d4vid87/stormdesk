import { settings, coords, num, U, everyVisible } from './app.js';
import { cacheContext } from './desk.js';
import { soilForecast } from './api.js';
import { soilSnapshot } from './forecast-environment.js';
import { initForecastHazards } from './forecast-hazards.js';
import { riverCrest, winterOutlook } from './balanced-context.js';

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
  dialog.addEventListener('close', () => {
    for (const {el, parent, next, hidden, open} of moved) {
      parent.insertBefore(el, next?.parentNode === parent ? next : null); el.hidden = hidden;
      for (const detail of el.querySelectorAll('details[open]')) detail.open = false;
      if (el.tagName === 'DETAILS') el.open = open;
    }
    moved = []; body.replaceChildren(); opener?.focus({preventScroll:true});
  });
  const open = (label, nodes, trigger) => {
    if (dialog.open) dialog.close();
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
    const main = node('strong', 'balanced-reading', 'Loading…'), summary = node('p', 'balanced-summary', 'Waiting for current data');
    box.append(heading, main, summary); button(box, label, nodes); contexts.append(box);
    return {box, main, summary};
  }
  const hazard = card('balanced-hazards', 'Hazards & atmosphere', 'Hazards & atmosphere details', [$('forecast-hazards'), $('forecast-atmosphere')]);
  const air = card('balanced-air', 'Air & ground', 'Air & ground details', [$('signal-details').querySelector('[data-panel="aqi"]'), $('forecast-environment')]);
  const riverBody = node('section'), winterBody = node('section'); parking.append(riverBody, winterBody);
  const river = card('balanced-river', 'River forecast', 'River forecast details', [riverBody]);
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
  function renderProvider(card, target, result, kind) {
    card.main.textContent = result.label; card.box.dataset.status = result.status;
    card.summary.textContent = kind === 'river' && result.crestTime ? `Forecast maximum ${when(result.crestTime)} · ${result.name} · ${result.status === 'stale' ? 'Stale' : result.source}` : result.summary;
    target.replaceChildren(node('p', '', result.summary));
    if (result.issuedTime) target.append(node('p', 'fd-note', `Issued ${when(result.issuedTime)} · valid through ${when(result.validUntil)} · device local time`));
    if (kind === 'river' && result.crestTime) {
      target.append(node('h3', '', `${num(result.crest, 1)} ${result.unit} forecast maximum`),
        node('p', '', `${when(result.crestTime)} · ${result.name}`),
        node('p', '', `Flood stage: ${result.floodStage == null ? 'Unavailable' : num(result.floodStage, 1) + ' ' + result.unit}. Category at forecast maximum: ${result.floodCategory || 'No threshold reached or thresholds unavailable'}.`));
    }
    if (kind === 'winter' && result.validFrom) target.append(node('p', '', `Valid from ${when(result.validFrom)}. This is planning guidance, not a warning.`));
    const link = node('a', 'balanced-source', `Open ${result.source} ↗`); link.href = result.sourceUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; target.append(link);
    if (result.status === 'configure') {
      const configure = node('button', 'balanced-detail-link', 'Open Settings'); configure.type = 'button';
      configure.onclick = () => { dialog.close(); $('btn-settings').click(); }; target.append(configure);
    }
  }
  let generation = 0;
  const contextKey = () => `${cacheContext('forecast')}|${settings().riverGauge}|${settings().units}`;
  let context = contextKey();
  function schedule() {
    const version = ++generation;
    everyVisible('balanced-river', 900, river.box, async () => {
      const result = await riverCrest(); if (version === generation) renderProvider(river, riverBody, result, 'river');
    });
    everyVisible('balanced-winter', 1800, winter.box, async () => {
      const result = await winterOutlook(); if (version === generation) renderProvider(winter, winterBody, result, 'winter');
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
    for (const c of [river, winter]) { c.main.textContent = 'Loading…'; c.summary.textContent = 'Waiting for current data'; }
    riverBody.replaceChildren(); winterBody.replaceChildren(); schedule();
  });
  return {
    updateAtmosphere(c = {}) {
      const metric = settings().units === 'metric';
      atmosphereText = `Visibility ${Number.isFinite(c.visibility) ? num(c.visibility / (metric ? 1000 : 1609.344), 1) + (metric ? ' km' : ' mi') : '—'} · Cloud base ${Number.isFinite(c.cloud_base_estimate) ? num(c.cloud_base_estimate * (metric ? 1 : 3.28084)) + (metric ? ' m' : ' ft') : '—'} (model estimates)`;
      renderHazards();
    },
  };
}
