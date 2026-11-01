// Reuse the live cards and their listeners; only their placement changes.
import { initStatusCards } from './status-cards.js';
import { styles, gaugeStyle } from './gauge-icons.js';
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
  view.innerHTML = '<button type="button" data-weather-view="radar" aria-pressed="true">Radar</button><button type="button" data-weather-view="outlook" aria-pressed="false">Forecast &amp; sky</button>';
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
  // Retain render targets for shared modules without exposing the retired dashboard section.
  const extra = document.createElement('div');
  extra.hidden = true;
  extra.append(document.querySelector('[data-panel="g-wet"]'), $('ticker'), $('ha-panel'));
  const outlook = document.createElement('details');
  outlook.className = 'card';
  outlook.id = 'advanced-outlook';
  outlook.innerHTML = '<summary>48-hour forecast &amp; model range</summary>';
  outlook.append($('desk-outlook'));
  stack.append(outlook);
  stack.append(extra);
  const shelf = document.createElement('div');
  shelf.id = 'radar-shelf';
  shelf.append($('gauges'));
  const controls = document.createElement('div');
  controls.className = 'gauge-style-control';
  controls.innerHTML = '<label for="gauge-style">Gauge style</label><select id="gauge-style"></select>';
  const select = controls.querySelector('select');
  styles.forEach(style => select.add(new Option(style.name + (style.id === 'orbit' ? ' · default' : ''), style.id)));
  select.value = gaugeStyle(settings().gaugeStyle);
  select.addEventListener('change', () => saveSettings({gaugeStyle: gaugeStyle(select.value)}));
  window.addEventListener('wd:settings', () => { select.value = gaugeStyle(settings().gaugeStyle); });
  shelf.append(controls);
  $('observatory-radar').prepend(shelf);
  const pauseIcons = () => document.documentElement.toggleAttribute('data-gauges-paused', document.hidden || !desk.classList.contains('active'));
  document.addEventListener('visibilitychange', pauseIcons);
  window.addEventListener('wd:section', pauseIcons);
  pauseIcons();
  const label = document.createElement('span');
  label.className = 'observatory-current-label';
  label.textContent = 'CURRENT CONDITIONS';
  $('hero').prepend(label);
  const dialog = document.createElement('dialog');
  dialog.id = 'forecast-dialog';
  dialog.setAttribute('aria-labelledby', 'forecast-dialog-title');
  dialog.innerHTML = '<h2 id="forecast-dialog-title"></h2><p></p><form method="dialog"><button>Close</button></form>';
  document.body.append(dialog);
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
