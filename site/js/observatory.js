// Reuse the live cards and their listeners; only their placement changes.
import { initStatusCards } from './status-cards.js';
import { settings, saveSettings, load, store, every, num, U, deg2compass, msToWind } from './app.js';
const $ = id => document.getElementById(id);
export function initObservatory() {
  if ($('instrument-stage')) return;
  document.documentElement.dataset.interface = 'instrument';
  const desk = $('desk'), stack = $('desk-stack');
  document.querySelector('header h1').textContent = 'StormDesk / Instrument';
  const clock = document.createElement('div');
  clock.id = 'instrument-clock';
  clock.append($('hero-clock'), $('clock-date'));
  document.querySelector('body > header').append(clock);
  document.querySelector('header h1').append($('hero-place'));
  const toolbar = document.createElement('div');
  toolbar.id = 'instrument-controls';
  toolbar.innerHTML = '<button id="instrument-toggle" aria-controls="instrument-shelf">Hide instruments</button><div class="instrument-actions"><label>Interface size <select id="instrument-scale" aria-label="Interface size"></select></label><button id="instrument-connect">Connect station</button><button id="instrument-motion">Pause icons</button></div>';
  for (const value of [.7,.85,1,1.15,1.35,1.5,1.75,2]) {
    const option = new Option(`${Math.round(value * 100)}%`, value);
    toolbar.querySelector('select').append(option);
  }
  const stage = document.createElement('div');
  stage.id = 'instrument-stage';
  const shelf = document.createElement('div');
  shelf.id = 'instrument-shelf';
  shelf.append($('gauges'));
  const context = document.createElement('div');
  context.id = 'instrument-context';
  const sun = document.createElement('section');
  sun.id = 'instrument-sun';
  sun.setAttribute('aria-label', 'Sunrise and sunset at the selected location');
  sun.innerHTML = '<div class="instrument-sun-end"><span class="instrument-sun-icon sunrise" aria-hidden="true">☀</span><small>Sunrise</small><strong id="instrument-sunrise">—</strong></div><div class="instrument-daylight"><svg viewBox="0 0 400 65" preserveAspectRatio="none" aria-hidden="true"><path d="M4 60Q200-55 396 60"/><circle id="instrument-day-marker" r="4" hidden/></svg><span id="instrument-daylight">Sun times unavailable</span><small id="instrument-sun-zone">Location time</small></div><div class="instrument-sun-end"><span class="instrument-sun-icon sunset" aria-hidden="true">☀</span><small>Sunset</small><strong id="instrument-sunset">—</strong></div>';
  const local = document.createElement('button');
  local.id = 'instrument-local';
  local.innerHTML = '<span>YOUR LOCAL CONTEXT</span><span id="instrument-source">Waiting for current conditions</span><span>Air quality · astronomy · station details →</span>';
  context.append($('hero'), sun, local);
  shelf.append(context);
  const radar = document.createElement('section');
  radar.id = 'instrument-radar';
  radar.setAttribute('aria-label', 'Live HookEcho NEXRAD radar');
  radar.innerHTML = '<div class="instrument-radar-off"><p>Radar is off</p><button id="instrument-enable-radar">Enable live radar</button></div>';
  radar.append($('desk-radar'));
  stage.append(shelf, radar);
  desk.prepend($('hero-alerts'), toolbar, stage);
  const details = document.createElement('dialog');
  details.id = 'instrument-details';
  details.setAttribute('aria-labelledby', 'instrument-details-title');
  details.innerHTML = '<form method="dialog"><button aria-label="Close local context">Close</button></form><aside id="observatory-signals"><h2 id="instrument-details-title">Local context</h2><div id="observatory-local" class="kv-rows">Waiting for readings</div></aside>';
  document.body.append(details);
  const signals = details.querySelector('aside');
  for (const id of ['alerts','severe','winter','tropical','aqi','sky','health'])
    signals.append(document.querySelector(`[data-panel="${id}"]`));
  const moon = document.createElement('div');
  moon.className = 'observatory-moon';
  moon.append($('hero-moon'), $('hero-moonset'));
  $('sky').parentElement.append(moon);
  initStatusCards(signals);
  local.onclick = () => details.showModal();
  // Shared forecast/tools modules retain their render targets outside the radar workspace.
  stack.hidden = true;
  stack.append(document.querySelector('[data-panel="g-wet"]'));
  const toggle = $('instrument-toggle');
  const narrow = matchMedia('(max-width: 700px)');
  let collapsed = load('wd.instrumentCollapsed', narrow.matches);
  const arrange = () => {
    shelf.hidden = collapsed;
    toggle.textContent = collapsed ? 'Show instruments' : 'Hide instruments';
    toggle.setAttribute('aria-expanded', String(!collapsed));
  };
  toggle.onclick = () => { collapsed = !collapsed; store('wd.instrumentCollapsed', collapsed); arrange(); };
  arrange();
  $('instrument-connect').onclick = () => {
    $('wizard').hidden = false;
    if (!$('wizard').open) $('wizard').showModal();
    $('wizard-choices').hidden = false;
    $('wizard-setup').hidden = true;
    $('btn-wiz-station').click();
  };
  $('instrument-enable-radar').onclick = () => saveSettings({deskRadar:true});
  let previousMotion = settings().motion === 'off' ? 'auto' : settings().motion;
  $('instrument-motion').onclick = () => {
    const paused = settings().motion === 'off';
    if (!paused) previousMotion = settings().motion;
    saveSettings({motion: paused ? previousMotion : 'off'});
  };
  $('instrument-scale').onchange = e => saveSettings({fontScale:Number(e.target.value)});
  const controls = () => {
    $('instrument-scale').value = String(settings().fontScale);
    $('instrument-motion').textContent = settings().motion === 'off' ? 'Animate icons' : 'Pause icons';
  };
  window.addEventListener('wd:settings', controls);
  controls();
  let today;
  const renderSun = () => {
    const rise = Number(today?.sunrise), set = Number(today?.sunset), now = Date.now()/1000;
    const valid = Number.isFinite(rise) && Number.isFinite(set) && set > rise
      && now >= Number(today.day_start_local) && now < Number(today.day_start_local) + 86400;
    $('instrument-sun').dataset.available = String(valid);
    $('instrument-sunrise').textContent = valid ? new Date(rise*1000).toLocaleTimeString([], {hour:'numeric',minute:'2-digit',hour12:true,...(today.timezone ? {timeZone:today.timezone} : {})}) : '—';
    $('instrument-sunset').textContent = valid ? new Date(set*1000).toLocaleTimeString([], {hour:'numeric',minute:'2-digit',hour12:true,...(today.timezone ? {timeZone:today.timezone} : {})}) : '—';
    $('instrument-sun-zone').textContent = valid ? (today.timezone || 'Device local time') : 'Location time';
    $('instrument-daylight').textContent = valid ? `${Math.floor((set-rise)/3600)}h ${Math.round((set-rise)%3600/60)}m daylight · ${now < rise ? 'Before sunrise' : now > set ? 'After sunset' : 'Daylight'}` : 'Sun times unavailable';
    const marker = $('instrument-day-marker');
    marker.toggleAttribute('hidden', !valid);
    if (valid) {
      const fraction = Math.max(0,Math.min(1,(now-rise)/(set-rise)));
      marker.setAttribute('cx', String(4+392*fraction));
      marker.setAttribute('cy', String(60-230*fraction*(1-fraction)));
    }
  };
  const render = e => {
    const fc = e.detail, c = fc?.current_conditions;
    if (!c) return;
    if (fc.forecast) {
      const now = Date.now()/1000;
      today = fc.forecast.daily?.find(d => now >= d.day_start_local && now < d.day_start_local+86400);
      if (today) today = {...today, timezone:fc.timezone};
      renderSun();
    }
    $('instrument-source').textContent = fc._provenance || (fc.local ? 'Station observation' : 'Forecast estimates · no station connected');
    const rows = [
      ['Wind', c.wind_avg == null ? 'Reading unavailable' : `${num(c.wind_avg)} ${U.wind()} ${c.wind_direction == null ? '' : deg2compass(c.wind_direction)} · gusts ${num(c.wind_gust)}`],
      ['Lightning', c.lightning_strike_count_last_3hr == null ? 'Reading unavailable' : `${num(c.lightning_strike_count_last_3hr)} strikes · ${fc.local ? 'last report' : 'last 3h'}`],
    ];
    $('observatory-local').replaceChildren(...rows.map(([name,value]) => {
      const row=document.createElement('div'),a=document.createElement('span'),b=document.createElement('span');
      a.textContent=name;b.textContent=value;row.append(a,b);return row;
    }));
  };
  every('instrument-sun',60,renderSun);
  window.addEventListener('wd:forecast', render);
  window.addEventListener('wd:current', render);
  window.addEventListener('wd:ws-obs', e => {
    const o = e.detail;
    render({detail:{local:true,current_conditions:{wind_avg:msToWind(o[2]),wind_gust:msToWind(o[3]),wind_direction:o[4],lightning_strike_count_last_3hr:o[15]}}});
  });
}
