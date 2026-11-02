// Reuse the live cards and their listeners; only their placement changes.
import { initStatusCards } from './status-cards.js';
import { initForecastDesk } from './forecast-desk.js';
import { renderDayForecastRange } from './forecast-insights.js';
import { styles, gaugeStyle, icon as gaugePreview } from './gauge-icons.js';
import { settings, saveSettings, num, U, deg2compass, msToWind } from './app.js';
import { forecast as deskForecast } from './desk.js';
const $ = id => document.getElementById(id);
export function initObservatory() {
  if ($('observatory-grid')) return;
  const desk = $('desk'), stack = $('desk-stack');
  const head = document.createElement('div');
  head.id = 'observatory-heading';
  head.innerHTML = '<div class="observatory-place"></div><div class="observatory-clock"><span>LOCAL TIME</span></div>';
  head.firstElementChild.append($('hero-place'), $('clock-date'));
  head.lastElementChild.append($('hero-clock'));
  head.append($('hero-alerts'));
  const view = document.createElement('div');
  view.className = 'weather-view';
  view.setAttribute('role', 'group');
  view.setAttribute('aria-label', 'Weather view');
  view.innerHTML = '<button type="button" data-weather-view="radar" aria-pressed="true"><span class="view-glyph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 3v9l6.4-6.4M12 21v-2M3 12h2m14 0h2"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg></span><span>Radar</span></button><button type="button" data-weather-view="outlook" aria-pressed="false"><span class="view-glyph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="8" cy="7" r="3"/><path d="M8 1v1M2 7H1m2.1-4.9.7.7M13 2l-.7.7M18.5 20H8a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.4-1.5 4.8 4.8 0 0 1 .6 9.5Z"/></svg></span><span>Forecast &amp; sky</span></button>';
  view.addEventListener('click', e => {
    const button = e.target.closest('[data-weather-view]');
    if (button) saveSettings({deskRadar: button.dataset.weatherView === 'radar'});
  });
  head.append(view);
  desk.insertBefore(head, stack);
  const grid = document.createElement('div');
  grid.id = 'observatory-grid';
  grid.innerHTML = `<div id="observatory-left"></div><section id="observatory-radar" aria-label="Local HookEcho radar"></section><aside id="observatory-signals"><h2>Local signals &amp; alerts</h2><div id="observatory-local" class="kv-rows"><div class="muted">Waiting for local readings</div></div></aside>`;
  grid.prepend(grid.querySelector('#observatory-radar'));
  stack.prepend(grid);
  const left = $('observatory-left');
  head.firstElementChild.after($('hero'));
  const forecast = document.createElement('section');
  forecast.id = 'observatory-forecast';
  forecast.innerHTML = '<div class="forecast-heading"><h2>10-day forecast</h2><span id="forecast-unit"></span></div><p class="observatory-note" id="forecast-coverage">Waiting for forecast</p><div class="forecast-columns" aria-hidden="true"><span>DAY</span><span></span><span>HIGH</span><span>LOW</span><span>RAIN</span></div>';
  forecast.append($('daycards'));
  left.append(forecast);
  $('observatory-radar').append($('desk-radar'));
  const signals = $('observatory-signals');
  const alerts = document.querySelector('[data-panel="alerts"]');
  alerts.open = true;
  signals.insertBefore(alerts, $('observatory-local'));
  for (const id of ['severe','winter','tropical','aqi','sky','health']) signals.append(document.querySelector(`[data-panel="${id}"]`));
  const sky = $('sky').parentElement;
  sky.querySelector('h2').textContent = 'Astronomy';
  const moon = document.createElement('div');
  moon.className = 'observatory-moon';
  moon.append($('hero-moon'), $('hero-moonset'));
  sky.append(moon);
  const health = $('health').parentElement;
  health.querySelector('h2').textContent = 'Device health';
  const state = document.createElement('div');
  state.className = 'observatory-note';
  state.append($('hero-live'), $('hero-batt'));
  health.insertBefore(state, $('health'));
  initStatusCards(signals);
  signals.hidden = true;
  // Retain render targets for shared modules without exposing the retired dashboard section.
  const extra = document.createElement('div');
  extra.hidden = true;
  extra.append(document.querySelector('[data-panel="g-wet"]'), $('ticker'), $('ha-panel'));
  const outlook = document.createElement('details');
  outlook.className = 'card';
  outlook.id = 'advanced-outlook';
  outlook.hidden = true;
  outlook.innerHTML = '<summary>48-hour forecast &amp; model range</summary>';
  outlook.append($('desk-outlook'));
  stack.append(outlook);
  stack.append(extra);
  const shelf = document.createElement('div');
  shelf.id = 'radar-shelf';
  shelf.append($('gauges'));
  const controls = document.createElement('div');
  controls.className = 'gauge-style-control';
  const trigger = document.createElement('button');
  trigger.id = 'gauge-style'; trigger.type = 'button';
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-controls', 'gauge-style-dialog');
  const chooser = document.createElement('dialog');
  chooser.id = 'gauge-style-dialog';
  chooser.setAttribute('aria-labelledby', 'gauge-style-title');
  chooser.innerHTML = '<div class="gauge-style-heading"><div><span class="gauge-style-eyebrow">MAKE IT YOURS</span><h2 id="gauge-style-title">Choose your instruments</h2><p>Five distinct looks. Your live readings, your style.</p></div><form method="dialog"><button type="submit" aria-label="Close gauge styles" autofocus>×</button></form></div><div class="gauge-style-options" role="group" aria-label="Gauge styles"></div><p class="gauge-style-footnote">Orbit Glass is the default · Motion follows your appearance settings.</p>';
  const choices = chooser.querySelector('.gauge-style-options');
  styles.forEach(style => {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.gaugeStyle = style.id;
    button.title = style.description;
    button.innerHTML = `<span class="gauge-style-status">${style.id === 'orbit' ? 'DEFAULT' : 'STYLE 0' + (styles.indexOf(style) + 1)}<span class="gauge-style-check" aria-hidden="true">✓</span></span><span class="gauge-style-demo" aria-hidden="true">${gaugePreview('Rain', style.id)}${gaugePreview('Wind', style.id)}</span><strong>${style.name}</strong><span class="gauge-style-tag">${style.tag}</span>`;
    button.setAttribute('aria-label', style.name + (style.id === 'orbit' ? ', default' : ''));
    button.addEventListener('click', () => {
      saveSettings({gaugeStyle: style.id});
      chooser.close(); trigger.focus({preventScroll:true});
    });
    choices.append(button);
  });
  let currentStyle;
  const syncStyle = () => {
    const selected = gaugeStyle(settings().gaugeStyle);
    if (currentStyle === selected) return;
    currentStyle = selected;
    const style = styles.find(style => style.id === selected);
    trigger.innerHTML = `${gaugePreview('Rain', selected)}<span><small>GAUGE STYLE</small><b>${style.name}</b></span><span class="gauge-style-chevron" aria-hidden="true">⌄</span>`;
    trigger.setAttribute('aria-label', 'Gauge style: ' + style.name + '. Choose a style');
    choices.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.gaugeStyle === selected)));
  };
  trigger.addEventListener('click', () => chooser.showModal());
  window.addEventListener('wd:settings', syncStyle);
  syncStyle();
  controls.append(trigger); document.body.append(chooser);
  shelf.append(controls);
  $('observatory-radar').prepend(shelf);
  const pauseIcons = () => document.documentElement.toggleAttribute('data-gauges-paused', document.hidden || !desk.classList.contains('active'));
  document.addEventListener('visibilitychange', pauseIcons);
  window.addEventListener('wd:section', pauseIcons);
  pauseIcons();
  initForecastDesk();
  const label = document.createElement('span');
  label.className = 'observatory-current-label';
  label.textContent = 'CURRENT CONDITIONS';
  $('hero').prepend(label);
  const dialog = document.createElement('dialog');
  dialog.id = 'forecast-dialog';
  dialog.setAttribute('aria-labelledby', 'forecast-dialog-title');
  dialog.innerHTML = '<h2 id="forecast-dialog-title"></h2><p></p><form method="dialog"><button>Close</button></form>';
  const range = document.createElement('div'); range.className = 'forecast-range';
  dialog.querySelector('form').before(range);
  document.body.append(dialog);
  const updateRange = () => renderDayForecastRange(range, Number(dialog.dataset.dayStart), Number(dialog.dataset.dayEnd));
  window.addEventListener('wd:models', () => { if (dialog.open) updateRange(); });
  window.addEventListener('wd:settings', () => { if (dialog.open) dialog.close(); });
  $('daycards').addEventListener('click', e => {
    const card = e.target.closest('.daycard');
    if (!card) return;
    dialog.querySelector('h2').textContent = `${card.querySelector('.dc-name').textContent} · ${card.querySelector('.dc-date').textContent}`;
    dialog.querySelector('p').textContent = `${card.querySelector('.dc-cond').textContent}. High: ${card.querySelector('.dc-temp b').textContent}. Low: ${card.querySelector('.dc-temp span').textContent}. Rain chance: ${card.querySelector('.dc-pop').textContent}.${card.dataset.precipAmount ? ` Expected precipitation: ${card.dataset.precipAmount}.` : ''}`;
    const agreement = document.createElement('p');
    agreement.className = 'forecast-model-note';
    agreement.textContent = `${card.dataset.agreement || 'Model agreement unavailable'}. Agreement describes model differences, not accuracy or the chance of rain.`;
    dialog.querySelector('.forecast-model-note')?.remove();
    dialog.querySelector('form').before(agreement);
    dialog.dataset.dayStart = card.dataset.dayStart;
    dialog.dataset.dayEnd = card.dataset.dayEnd;
    updateRange();
    dialog.showModal();
  });
  const render = e => {
    const fc = e.detail, c = fc?.current_conditions;
    if (!c) return;
    if (fc.forecast) {
      const count = Math.min(10, fc.forecast.daily?.length || 0);
      $('forecast-coverage').textContent = (fc._cached ? 'Saved forecast · ' : '') + (count === 10 ? 'Select a day for details' : count ? `${count} days available · select for details` : 'Forecast unavailable');
      $('forecast-unit').textContent = U.temp();
    }
    const strikes = c.lightning_strike_count_last_3hr;
    const rows = [
      ['ϟ Lightning', strikes == null ? 'Reading unavailable' : strikes === 0 ? `No strikes · ${fc.local ? 'last report' : 'last 3h'}` : `${num(strikes)} strikes · ${fc.local ? 'last report' : 'last 3h'}`],
      ['↗ Wind', c.wind_avg == null ? 'Reading unavailable' : `${num(c.wind_avg)} ${U.wind()} ${c.wind_direction == null ? '' : deg2compass(c.wind_direction)} · gusts ${num(c.wind_gust)}`],
    ];
    $('observatory-local').replaceChildren(...rows.map(([name,value])=>{
      const row=document.createElement('div'),a=document.createElement('span'),b=document.createElement('span');
      a.textContent=name;b.textContent=value;row.append(a,b);return row;
    }));
    $('hero-place').textContent = settings().stationName || 'Your location';
  };
  let pending = null, frame = 0;
  window.addEventListener('wd:forecast', e => {
    cancelAnimationFrame(frame); frame = 0; pending = null;
    if (!document.hidden && desk.classList.contains('active')) render(e);
    else queue(e);
  });
  const queue = e => {
    pending = e;
    if (frame || document.hidden || !desk.classList.contains('active')) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!document.hidden && desk.classList.contains('active') && pending) { render(pending); pending = null; }
    });
  };
  window.addEventListener('wd:current', queue);
  window.addEventListener('wd:section', e => { if (e.detail === 'desk' && pending) queue(pending); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && pending) queue(pending); });
  window.addEventListener('wd:ws-obs', e => {
    if (deskForecast() || settings().activePlace) return;
    const o = e.detail;
    queue({detail:{local:true,current_conditions:{wind_avg:msToWind(o[2]),wind_gust:msToWind(o[3]),wind_direction:o[4],lightning_strike_count_last_3hr:o[15]}}});
  });
}
