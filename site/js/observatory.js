// Reuse the live cards and their listeners; only their placement changes.
import { initStatusCards } from './status-cards.js';
import { wx } from './icons.js';
import { settings, saveSettings, load, store, every, num, U, deg2compass, msToWind } from './app.js';
const $ = id => document.getElementById(id);
export function initObservatory() {
  if ($('instrument-stage')) return;
  document.documentElement.dataset.interface = 'instrument';
  const desk = $('desk'), stack = $('desk-stack');
  document.querySelector('header h1').textContent = 'STORMDESK';
  const clock = document.createElement('div');
  clock.id = 'instrument-clock';
  clock.append($('hero-clock'), $('clock-date'));
  document.querySelector('body > header').append(clock);
  const toolbar = document.createElement('div');
  toolbar.id = 'instrument-controls';
  toolbar.innerHTML = '<button id="instrument-toggle" aria-controls="instrument-shelf">Hide instruments</button><div class="instrument-actions"><label>Interface size <select id="instrument-scale" aria-label="Interface size"></select></label></div>';
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
  sun.setAttribute('aria-label', 'Daylight Ribbon: sunrise, sunset, and the next 24 hours');
  const sunIcon = (setting) => `<svg class="instrument-sun-icon" viewBox="0 0 64 48" aria-hidden="true"><g class="horizon-rays" stroke="${setting ? '#e9a4a5' : '#ffca77'}" stroke-width="2" stroke-linecap="round"><path d="M32 4V10M12 12L17 17M5 30H12M52 12L47 17M52 30H59"/></g><path d="M17 33a15 15 0 0 1 30 0" fill="${setting ? '#e68992' : '#ffca77'}"/><path d="M6 34H58M18 40H46M25 45H39" stroke="${setting ? '#d99b9f' : '#e8c28e'}" stroke-linecap="round"/></svg>`;
  sun.innerHTML = `<button id="instrument-sun-toggle" type="button" aria-pressed="false" aria-label="Sun cycle shown. Switch to 24-hour forecast" aria-controls="instrument-sun-view instrument-hourly"><span>Sun cycle <span aria-hidden="true">⇄</span> 24-hour forecast</span><small>Click to switch</small></button>
    <div id="instrument-sun-view">
      <div class="ribbon-endpoints"><div class="instrument-sun-end sunrise">${sunIcon(false)}<div><small>Sunrise</small><strong id="instrument-sunrise">—</strong></div></div>
      <div class="instrument-sun-end sunset">${sunIcon(true)}<div><small>Sunset</small><strong id="instrument-sunset">—</strong></div></div></div>
      <div id="instrument-day-ribbon" role="img" aria-label="Daylight hours unavailable">${'<span></span>'.repeat(24)}</div>
      <div class="ribbon-caption"><span id="instrument-next-sun">Your daylight</span><span id="instrument-daylight">Sun times unavailable</span><small id="instrument-sun-zone">Location time</small></div>
    </div>
    <div id="instrument-hourly" hidden><div class="ribbon-forecast-heading"><span id="instrument-hourly-source">Next 24 hours</span><div><button id="instrument-hourly-prev" type="button" aria-label="Earlier forecast hours">‹</button><button id="instrument-hourly-next" type="button" aria-label="Later forecast hours">›</button></div></div><div id="instrument-hourly-rail" role="region" aria-label="Next 24 hours of weather. Swipe or use the arrow buttons."></div></div>`;
  let forecastView = false, pointerStart, swiping = false;
  const rail = sun.querySelector('#instrument-hourly-rail');
  const scrollControls = () => {
    $('instrument-hourly-prev').disabled = rail.scrollLeft <= 1;
    $('instrument-hourly-next').disabled = rail.scrollLeft >= rail.scrollWidth - rail.clientWidth - 2;
  };
  const switchView = () => {
    forecastView = !forecastView;
    $('instrument-sun-view').hidden = forecastView;
    $('instrument-hourly').hidden = !forecastView;
    sun.dataset.view = forecastView ? 'forecast' : 'sun';
    $('instrument-sun-toggle').setAttribute('aria-pressed', String(forecastView));
    $('instrument-sun-toggle').setAttribute('aria-label', forecastView
      ? '24-hour forecast shown. Switch to sunrise and sunset'
      : 'Sun cycle shown. Switch to 24-hour forecast');
    $('instrument-sun-toggle').querySelector('span').textContent = forecastView
      ? '24-hour forecast  ⇄  Sun cycle' : 'Sun cycle  ⇄  24-hour forecast';
    requestAnimationFrame(scrollControls);
  };
  sun.querySelector('#instrument-sun-toggle').addEventListener('click', switchView);
  sun.addEventListener('pointerdown', e => { pointerStart = [e.clientX, e.clientY]; swiping = false; });
  sun.addEventListener('pointermove', e => {
    if (pointerStart && Math.hypot(e.clientX-pointerStart[0], e.clientY-pointerStart[1]) > 8) swiping = true;
  });
  sun.addEventListener('pointercancel', () => { swiping = true; pointerStart = null; });
  sun.addEventListener('click', e => {
    if (!swiping && !e.target.closest('button') && e.target !== rail) switchView();
    pointerStart = null;
  });
  rail.addEventListener('scroll', scrollControls);
  new ResizeObserver(scrollControls).observe(rail);
  for (const [id, direction] of [['instrument-hourly-prev', -1], ['instrument-hourly-next', 1]])
    sun.querySelector('#'+id).addEventListener('click', () => rail.scrollBy({
      left:direction * Math.max(160, rail.clientWidth * .7),
      behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    }));
  rail.addEventListener('wheel', e => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && (
      e.deltaY > 0 && rail.scrollLeft < rail.scrollWidth-rail.clientWidth-1 || e.deltaY < 0 && rail.scrollLeft > 0)) {
      e.preventDefault(); rail.scrollLeft += e.deltaY;
    }
  }, {passive:false});
  context.append($('hero'), sun);
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
  details.innerHTML = '<form method="dialog"><button aria-label="Close local context">Close</button></form><aside id="observatory-signals"><h2 id="instrument-details-title">Local context</h2><p id="instrument-source">Waiting for current conditions</p><div id="observatory-local" class="kv-rows">Waiting for readings</div></aside>';
  document.body.append(details);
  const signals = details.querySelector('aside');
  for (const id of ['alerts','severe','winter','tropical','aqi','sky','health'])
    signals.append(document.querySelector(`[data-panel="${id}"]`));
  const moon = document.createElement('div');
  moon.className = 'observatory-moon';
  moon.append($('hero-moon'), $('hero-moonset'));
  $('sky').parentElement.append(moon);
  initStatusCards(signals);
  $('instrument-details-open').onclick = () => details.showModal();
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
    $('btn-close').click();
    $('wizard').hidden = false;
    if (!$('wizard').open) $('wizard').showModal();
    $('wizard-choices').hidden = false;
    $('wizard-setup').hidden = true;
    $('btn-wiz-station').click();
  };
  $('instrument-enable-radar').onclick = () => saveSettings({deskRadar:true});
  $('instrument-scale').onchange = e => saveSettings({fontScale:Number(e.target.value)});
  const controls = () => {
    $('instrument-scale').value = String(settings().fontScale);
  };
  window.addEventListener('wd:settings', controls);
  controls();
  let today, tomorrow, latestForecast;
  const renderSun = () => {
    const days = latestForecast?.forecast?.daily || [], current = Date.now()/1000;
    const dayIndex = days.findIndex(d => current >= d.day_start_local && current < d.day_start_local+86400);
    today = dayIndex < 0 ? null : {...days[dayIndex], timezone:latestForecast.timezone};
    tomorrow = days[dayIndex+1];
    const rise = Number(today?.sunrise), set = Number(today?.sunset), now = current;
    const valid = Number.isFinite(rise) && Number.isFinite(set) && set > rise
      && now >= Number(today.day_start_local) && now < Number(today.day_start_local) + 86400;
    $('instrument-sun').dataset.available = String(valid);
    $('instrument-sun').dataset.phase = !valid ? 'unknown' : now < rise ? 'dawn' : now > set ? 'night' : 'day';
    const nextAt = now < rise ? rise : now < set ? set : tomorrow?.sunrise;
    const remaining = Math.max(0, Math.ceil((nextAt - now)/60));
    $('instrument-next-sun').textContent = valid && Number.isFinite(remaining)
      ? `${now < rise || now > set ? 'Sunrise' : 'Sunset'} in ${Math.floor(remaining/60)}h ${remaining%60}m`
      : valid ? 'After sunset' : 'Your daylight';
    $('instrument-sunrise').textContent = valid ? new Date(rise*1000).toLocaleTimeString([], {hour:'numeric',minute:'2-digit',hour12:true,...(today.timezone ? {timeZone:today.timezone} : {})}) : '—';
    $('instrument-sunset').textContent = valid ? new Date(set*1000).toLocaleTimeString([], {hour:'numeric',minute:'2-digit',hour12:true,...(today.timezone ? {timeZone:today.timezone} : {})}) : '—';
    $('instrument-sun-zone').textContent = valid ? (today.timezone || 'Device local time') : 'Location time';
    const daylightMinutes = Math.round((set-rise)/60);
    $('instrument-daylight').textContent = valid ? `${Math.floor(daylightMinutes/60)}h ${daylightMinutes%60}m daylight · ${now < rise ? 'Before sunrise' : now > set ? 'After sunset' : 'Daylight'}` : 'Sun times unavailable';
    const ribbon = $('instrument-day-ribbon');
    ribbon.setAttribute('aria-label', valid ? `Daylight from ${$('instrument-sunrise').textContent} to ${$('instrument-sunset').textContent}. Current hour marked.` : 'Daylight hours unavailable');
    const localHour = valid ? Number(new Intl.DateTimeFormat('en-GB', {
      hour:'numeric',hourCycle:'h23',...(today.timezone ? {timeZone:today.timezone} : {}),
    }).format(new Date())) : -1;
    [...ribbon.children].forEach((bar, hour) => {
      const at = Number(today?.day_start_local) + hour*3600 + 1800;
      bar.classList.toggle('daylight', valid && at >= rise && at < set);
      bar.classList.toggle('current', valid && hour === localHour);
      bar.style.setProperty('--ribbon-strength', String(.35 + .65 * Math.sin((hour+.5)/24*Math.PI)));
    });
  };
  const renderHours = () => {
    const now = Date.now()/1000, seen = new Set();
    const hours = (latestForecast?.forecast?.hourly || [])
      .filter(h => typeof h.time === 'number' && Number.isFinite(h.time) && h.time >= now && h.time < now + 86400)
      .sort((a,b) => a.time-b.time).filter(h => !seen.has(h.time) && seen.add(h.time)).slice(0,24);
    const scroll = rail.scrollLeft, content = document.createDocumentFragment();
    for (const h of hours) {
      const at = new Date(h.time*1000), opts = latestForecast.timezone ? {timeZone:latestForecast.timezone} : {};
      const stamp = at.toLocaleTimeString([], {hour:'numeric',hour12:true,...opts});
      const day = latestForecast.forecast.daily?.find(d => h.time >= d.day_start_local && h.time < d.day_start_local+86400);
      const daylight = day && h.time >= day.sunrise && h.time < day.sunset;
      const key = typeof h.icon === 'string' ? h.icon : '';
      const glyph = day && !daylight ? key.replace('-day','-night') : key;
      const card = document.createElement('div'); card.className = 'ribbon-hour';
      card.classList.toggle('daylight', !!daylight);
      const time = document.createElement('time'); time.dateTime = at.toISOString(); time.textContent = stamp;
      const icon = document.createElement('span'); icon.innerHTML = wx(glyph,32);
      const temp = document.createElement('strong');
      temp.textContent = typeof h.air_temperature === 'number' && Number.isFinite(h.air_temperature) ? `${Math.round(h.air_temperature)}°` : '—';
      const conditions = document.createElement('small'); conditions.textContent = h.conditions || 'Weather unavailable';
      card.setAttribute('aria-label', `${stamp}, ${temp.textContent} ${U.temp()}, ${conditions.textContent}`);
      card.append(time,icon,temp,conditions); content.append(card);
    }
    if (!hours.length) {
      const empty = document.createElement('p'); empty.textContent = 'Hourly forecast unavailable';
      content.append(empty);
    }
    rail.replaceChildren(content); rail.scrollLeft = scroll;
    $('instrument-hourly-source').textContent = `Next 24 hours · ${U.temp()}`;
    scrollControls();
  };
  const render = e => {
    const fc = e.detail, c = fc?.current_conditions;
    if (!c) return;
    if (fc.forecast) {
      latestForecast = fc;
      renderSun();
      renderHours();
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
  let forecastContext = JSON.stringify([settings().units, settings().lat, settings().lon, settings().activePlace, settings().stationId]);
  window.addEventListener('wd:settings', () => {
    const next = JSON.stringify([settings().units, settings().lat, settings().lon, settings().activePlace, settings().stationId]);
    if (next !== forecastContext) {
      forecastContext = next; latestForecast = null;
      renderSun(); renderHours();
    }
  });
  every('instrument-sun',60,() => { renderSun(); renderHours(); });
  window.addEventListener('wd:forecast', render);
  window.addEventListener('wd:current', render);
  window.addEventListener('wd:ws-obs', e => {
    const o = e.detail;
    render({detail:{local:true,current_conditions:{wind_avg:msToWind(o[2]),wind_gust:msToWind(o[3]),wind_direction:o[4],lightning_strike_count_last_3hr:o[15]}}});
  });
}
