// Reuse the live cards and their listeners; only their placement changes.
import { initStatusCards } from './status-cards.js';
import { settings, num, U, deg2compass, msToWind } from './app.js';
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
  desk.insertBefore(head, stack);
  const grid = document.createElement('div');
  grid.id = 'observatory-grid';
  grid.innerHTML = `<div id="observatory-left"></div><section id="observatory-radar" aria-label="Local HookEcho radar"><div class="observatory-radar-heading"><span>LOCAL RADAR · HOOKECHO</span></div><div class="observatory-radar-off"><p>Radar preview is off</p><span>Open live radar, or enable the Weather radar panel in Settings.</span></div></section><aside id="observatory-signals"><h2>Local signals &amp; alerts</h2><div id="observatory-local" class="kv-rows"><div class="muted">Waiting for local readings</div></div></aside>`;
  stack.prepend(grid);
  const left = $('observatory-left');
  left.append($('hero'));
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
  extra.append(document.querySelector('[data-panel="g-wet"]'), $('desk-outlook'), $('ticker'), $('ha-panel'));
  stack.append(extra);
  desk.insertBefore($('gauges'), stack);
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
    dialog.showModal();
  });
  const render = e => {
    const fc = e.detail, c = fc?.current_conditions;
    if (!c) return;
    if (fc.forecast) {
      const count = Math.min(10, fc.forecast.daily?.length || 0);
      $('forecast-coverage').textContent = count === 10 ? 'Select a day for details' : count ? `${count} days available · select for details` : 'Forecast unavailable';
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
  window.addEventListener('wd:forecast', render);
  window.addEventListener('wd:current', render);
  window.addEventListener('wd:ws-obs', e => {
    const o = e.detail;
    render({detail:{local:true,current_conditions:{wind_avg:msToWind(o[2]),wind_gust:msToWind(o[3]),wind_direction:o[4],lightning_strike_count_last_3hr:o[15]}}});
  });
}
