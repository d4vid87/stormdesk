import { initLayout, snapshot, restore, DEFAULT } from './js/layout.js';
// Synthetic forecast + station report for CI. The Desk paints nothing without one, and a
// screenshot of an empty page proves nothing. Fixed values, moving timestamps: the sun has to be
// up for the day layouts, and every chart wants times near now.
const now = Math.floor(Date.now() / 1000);
const day = Math.floor(now / 86400) * 86400;

const daily = Array.from({ length: 10 }, (_, i) => ({
  day_start_local: day + i * 86400,
  air_temp_high: 78 - i,
  air_temp_low: 58 - i,
  conditions: 'Partly Cloudy',
  icon: i % 3 === 0 ? 'partly-cloudy-day' : i % 3 === 1 ? 'rainy' : 'clear-day',
  precip_probability: (i * 10) % 70,
  sunrise: day + i * 86400 + 6 * 3600 + 40 * 60,
  sunset: day + i * 86400 + 19 * 3600 + 50 * 60,
}));

const hourly = Array.from({ length: 72 }, (_, i) => ({
  time: now - 3600 + i * 3600,
  air_temperature: 70 + 8 * Math.sin(i / 4),
  feels_like: 70 + 8 * Math.sin(i / 4),
  relative_humidity: 55 + (i % 20),
  precip_probability: (i * 7) % 90,
  precip: (i % 9 === 0) ? 0.02 : 0,
  wind_avg: 6 + (i % 5),
  wind_gust: 12 + (i % 9),
  wind_direction: (i * 17) % 360,
  sea_level_pressure: 1013 + Math.sin(i / 6),
  uv: Math.max(0, 6 - Math.abs(12 - (i % 24))),
  conditions: 'Partly Cloudy',
  icon: 'partly-cloudy-day',
}));

const fc = {
  latitude: 32.75, longitude: -97.33, timezone: 'America/Chicago', elevation: 180,
  current_conditions: {
    time: now, conditions: 'Partly Cloudy', icon: 'partly-cloudy-day',
    air_temperature: 72.4, feels_like: 74.1, dew_point: 61.2, relative_humidity: 68,
    sea_level_pressure: 1014.2, station_pressure: 993.1, pressure_trend: 'steady',
    wind_avg: 7.2, wind_gust: 14.6, wind_direction: 190, uv: 4, brightness: 42000,
    solar_radiation: 520, precip_accum_local_day: 0.12, visibility: 16093,
    air_density: 1.18, wet_bulb_temperature: 65.8, lightning_strike_count_last_3hr: 0,
  },
  forecast: { daily, hourly },
};

addEventListener('load', () => {
  console.assert(document.querySelector('#settings-alerts #btn-voice-test') && document.querySelector('#settings-alerts #voice-status'), 'Voice test and status stay beside the speech setting');
  const cards = [...document.querySelectorAll('[data-settings-category]')];
  console.assert(cards.length === 6, 'Settings home has six categories');
  const retained = document.getElementById('set-units');
  const retainedValue = retained.value;
  cards.forEach(card => {
    card.click();
    console.assert(!document.getElementById(`settings-${card.dataset.settingsCategory}`).hidden, 'Each card opens its category');
    document.getElementById('settings-back').click();
  });
  console.assert(retained === document.getElementById('set-units') && retained.value === retainedValue, 'Category navigation preserves original controls and unsaved values');
  for(const [category,ids] of Object.entries({everyday:['place-q','set-units','set-clock'],appearance:['set-palette','set-font','set-motion'],alerts:['set-speak','set-quiet-start','rule-list'],station:['set-source','set-token','set-device','set-elev','health-center'],radar:['set-desk-radar','set-radar-site'],tools:['set-retention','btn-backup','set-mqtt-url','set-legacy-lan','btn-diag']})) {
    console.assert(ids.every(id => document.querySelector(`#settings-${category} #${id}`)), `Settings controls assigned: ${category}`);
  }
  const settingsSearch = document.getElementById('settings-search');
  settingsSearch.value = 'backup'; settingsSearch.dispatchEvent(new Event('input'));
  console.assert(cards.filter(card => !card.hidden).length === 1 && !document.querySelector('[data-settings-category="tools"]').hidden, 'Search finds tools by nested controls');
  document.getElementById('drawer').dispatchEvent(new Event('settings:home'));
  dispatchEvent(new CustomEvent('wd:forecast', { detail: fc }));
  // Storm watch shares the same feed; missing readings must not become reassuring zeroes.
  const pressureCard = document.querySelector('[data-panel="g-press"]');
  console.assert(getComputedStyle(pressureCard).display !== 'none', 'Observatory shows pressure in the eight-reading rail');
  const gauges = [...document.querySelectorAll('#gauges > .gauge')].filter(el => getComputedStyle(el).display !== 'none');
  console.assert(gauges.length === 8, 'Observatory overview has exactly eight readings');
  console.assert(gauges.at(-2).dataset.panel === 'g-hum' && gauges.at(-1).dataset.panel === 'g-dew', 'Dew point follows humidity in the readings rail');
  console.assert(document.querySelector('#g-dew .ginner b').textContent === '61°', 'Dew point retains the live forecast value');
  console.assert(gauges.every(el => el.querySelector('svg.field-instrument')), 'All eight readings use field instruments');
  console.assert(gauges.every(el => getComputedStyle(el.querySelector('.gwrap > span')).display !== 'none'), 'Instrument faces are visible');
  console.assert(document.getElementById('g-ltg').dataset.unavailable === 'false', 'Zero reported strikes is known data');
  console.assert(document.querySelector('#g-wet svg') && document.querySelector('#g-ltg svg'), 'Wet bulb and lightning have instrument faces');
  console.assert(document.getElementById('hero-alerts').parentElement.id === 'desk', 'Instrument alert banner sits above the radar workspace');
  console.assert(/\d+:\d{2}/.test(document.getElementById('clock-time').textContent), 'Local clock shows hours and minutes');
  console.assert(document.getElementById('instrument-clock').closest('header'), 'Clock sits in the upper-right header');
  console.assert(document.querySelector('header h1').textContent === 'STORMDESK', 'Header shows STORMDESK');
  console.assert(!document.querySelector('#instrument-controls #instrument-connect, #instrument-controls #instrument-motion') && document.querySelector('#settings-station #instrument-connect'), 'Station setup is in settings and dashboard motion control is removed');
  console.assert(document.querySelector('header [data-section="desk"]').textContent.includes('Dashboard'), 'Main workspace is named Dashboard');
  const gaugeRow = document.getElementById('gauges'), initialOrder = snapshot();
  const gaugeIds = () => [...gaugeRow.children].map(el => el.dataset.panel);
  const shiftGauge = (el, key) => el.dispatchEvent(new KeyboardEvent('keydown', {key,altKey:true,bubbles:true,cancelable:true}));
  const rainGauge = gaugeRow.firstElementChild;
  shiftGauge(rainGauge, 'ArrowRight');
  console.assert(gaugeRow.children[1] === rainGauge && document.activeElement === rainGauge, 'Alt + Right moves one position and preserves focus');
  console.assert(!document.getElementById('detail')?.classList.contains('open'), 'Reordering does not open measurement details');
  console.assert(JSON.parse(localStorage.getItem('wd.gaugeOrder')).join() === gaugeIds().join(), 'Gauge order is saved on this device');
  initLayout(); initLayout();
  dispatchEvent(new CustomEvent('wd:forecast', {detail:fc}));
  console.assert(gaugeRow.children[1] === rainGauge && gaugeRow.querySelectorAll('h3').length === 8, 'Reinitialization and live updates preserve order without duplicate controls');
  console.assert([...gaugeRow.children].every(el => getComputedStyle(el).order === '0'), 'Visual order follows the saved DOM order');
  shiftGauge(rainGauge, 'ArrowLeft');
  shiftGauge(rainGauge, 'ArrowLeft');
  console.assert(gaugeRow.firstElementChild === rainGauge, 'Movement stops at the first gauge');
  const lastGauge = gaugeRow.lastElementChild;
  shiftGauge(lastGauge, 'ArrowRight');
  console.assert(gaugeRow.lastElementChild === lastGauge, 'Movement stops at the last gauge');
  const reordered = snapshot();
  reordered['g-dew'].order = -1;
  restore(reordered);
  console.assert(gaugeRow.firstElementChild === lastGauge, 'Saved layouts restore only gauge ordering');
  restore({'g-rain':{order:'invalid'},malicious:{order:-2}});
  console.assert(gaugeRow.children.length === 8 && gaugeRow.firstElementChild === lastGauge, 'Invalid layout fields cannot replace gauges');
  restore(DEFAULT); restore(initialOrder);
  rainGauge.click();
  console.assert(document.getElementById('detail').classList.contains('open'), 'Gauge values still open measurement details');
  document.getElementById('detail-close').click();
  console.assert(document.querySelector('#settings-appearance #set-motion'), 'Icon animation stays in Appearance settings');
  console.assert(document.querySelector('#hero-icon .weather-aura') && document.querySelector('#instrument-day-ribbon'), 'Conditions and sun use the illustrated visual treatment');
  console.assert(document.querySelectorAll('#daycards > .daycard').length === 10, 'Shared tool data retains available days');
  console.assert(document.getElementById('desk-stack').hidden, 'Retired ten-day and six-hour panels stay outside the radar workspace');
  console.assert(['severe','winter','tropical','alerts'].every(id => document.querySelector(`#observatory-signals [data-panel="${id}"]`)), 'Safety tools stay accessible through settings');
  console.assert(!document.getElementById('instrument-local') && document.getElementById('instrument-context').children.length === 2, 'Local Context card is removed and the sun strip shares the row with current conditions');
  document.getElementById('instrument-details-open').click();
  console.assert(document.getElementById('instrument-details').open, 'Local weather details remain accessible from settings');
  document.getElementById('instrument-details').close();
  const shelf = document.getElementById('instrument-shelf'), toggle = document.getElementById('instrument-toggle');
  const wasHidden = shelf.hidden;
  toggle.click();
  console.assert(shelf.hidden !== wasHidden && toggle.getAttribute('aria-expanded') === String(!shelf.hidden), 'Instrument collapse updates screen and accessibility state');
  toggle.click();
  console.assert(document.getElementById('instrument-sunrise').textContent !== '—', 'Today’s sunrise renders above radar');
  const ribbon = document.getElementById('instrument-sun');
  const ribbonHeight = ribbon.getBoundingClientRect().height;
  const ribbonToggle = document.getElementById('instrument-sun-toggle');
  ribbonToggle.click();
  console.assert(!document.getElementById('instrument-hourly').hidden && document.querySelectorAll('.ribbon-hour').length === 24, 'Click shows the next 24 real provider hours');
  console.assert(ribbon.getBoundingClientRect().height === ribbonHeight, 'Hourly view preserves the sun strip height');
  const firstHour = [...fc.forecast.hourly].find(h => h.time >= Date.now()/1000);
  console.assert(document.querySelector('.ribbon-hour strong').textContent === Math.round(firstHour.air_temperature) + '°', 'Hourly temperature comes from the forecast');
  document.getElementById('instrument-hourly-next').click();
  console.assert(!document.getElementById('instrument-hourly').hidden, 'Scrolling does not flip back to sun times');
  dispatchEvent(new CustomEvent('wd:current', {detail:{...fc,current_conditions:{...fc.current_conditions,wind_avg:1}}}));
  console.assert(document.querySelectorAll('.ribbon-hour').length === 24, 'Station updates preserve the hourly forecast');
  ribbonToggle.click();
  console.assert(!document.getElementById('instrument-sun-view').hidden, 'Second click restores sunrise and sunset');
  const radarBox = document.getElementById('instrument-radar').getBoundingClientRect();
  console.assert(radarBox.width > document.getElementById('desk').clientWidth * .85, 'Radar uses full workspace width');
  console.assert(radarBox.height >= 150, 'Radar remains usable at small sizes');
  dispatchEvent(new CustomEvent('wd:forecast', { detail: { current_conditions: {}, forecast: { daily: [{}], hourly: [] } } }));
  console.assert(document.querySelector('#daycards .dc-pop').textContent === '—', 'Unavailable rain chance is not zero');
  console.assert(document.querySelectorAll('.ribbon-hour').length === 0 && document.getElementById('instrument-hourly-rail').textContent.includes('unavailable'), 'Missing hourly data is not simulated');
  console.assert(document.querySelector('#g-ltg').textContent.includes('unavailable'), 'Missing lightning is unavailable, not no strikes');
  console.assert(document.querySelector('#g-wet').dataset.unavailable === 'true', 'Missing wet bulb hides its needle');
  console.assert(document.querySelector('#g-rain').dataset.unavailable === 'true', 'Missing rain is not dry');
  console.assert(!document.querySelector('#g-rain .fi-fill, #g-dew .fi-needle, #g-wbgt .fi-fill'), 'Unavailable values have no filled instrument indicators');
  dispatchEvent(new CustomEvent('wd:forecast', { detail: fc }));
  dispatchEvent(new CustomEvent('wd:alerts', { detail: [{ properties: {
    event: '<b>Test advisory</b>', severity: 'Severe', areaDesc:'Fixture county', expires:new Date((now+3600)*1000).toISOString(), description: '<img src=x onerror=alert(1)>', instruction:'Fixture instructions',
  } }] }));
  document.querySelector('#hero-alerts button').click();
  console.assert(document.getElementById('radar-alert-dialog').open && document.getElementById('radar-alert-list').textContent.includes('Fixture county'), 'Banner opens affected areas and official details');
  console.assert(document.getElementById('radar-alert-list').textContent.includes('Expires (device time)') && document.getElementById('radar-alert-list').textContent.includes('Fixture instructions') && !document.querySelector('#radar-alert-list img'), 'Alert text stays escaped with expiry and instructions');
  document.getElementById('radar-alert-dialog').close();
  dispatchEvent(new CustomEvent('wd:alerts', {detail:[{properties:{event:'Air Quality Alert',severity:'Unknown'}}]}));
  console.assert(document.getElementById('hero-alerts').textContent.includes('National Weather Service') && !document.getElementById('hero-alerts').textContent.includes('Unknown'), 'Banner names the official source instead of Unknown');
  console.assert(document.getElementById('hero-alerts').style.getPropertyValue('--alert-color') === '#ffffff' && document.getElementById('radar-banner').style.getPropertyValue('--alert-color') === '#ffffff', 'Air Quality Alert uses white in Weather and Radar banners');
  dispatchEvent(new CustomEvent('wd:alerts', { detail: [] }));
  // api.OBS order: time, temp, rh, press, ... — index by name off the module the page already
  // loaded rather than hard-coding a shape that moves.
  import('./js/api.js').then(async ({ OBS }) => {
    const o = [];
    o[OBS.time] = now; o[OBS.temp] = 22.4; o[OBS.rh] = 68; o[OBS.press] = 993.1;
    o[OBS.windAvg] = 3.2; o[OBS.windGust] = 6.5; o[OBS.windDir] = 190;
    o[OBS.uv] = 4; o[OBS.solar] = 520; o[OBS.dayRain] = 3; o[OBS.battery] = 2.71;
    dispatchEvent(new CustomEvent('wd:ws-obs', { detail: o }));
    console.assert(document.getElementById('observatory-local').textContent.includes('gusts'), 'Local signals refresh with station observations');
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));
    await settle();
    console.assert(document.querySelectorAll('.status-tile').length === 3, 'Status cards show air quality, moon and sunset');
    for (const kind of ['aqi','sky','health']) {
      document.querySelector(`[data-signal-detail="${kind}"]`).click();
      console.assert(document.getElementById('signal-details').open && !document.querySelector(`#signal-details [data-panel="${kind}"]`).hidden, `Status detail opens original live source: ${kind}`);
      document.getElementById('signal-details').close();
    }
    const aqi = document.getElementById('aqi-val'), oldAqi = aqi.textContent;
    aqi.textContent = '--'; await settle();
    console.assert(document.getElementById('status-aqi-label').textContent === 'Reading unavailable', 'Missing AQI never shows Good');
    aqi.textContent = oldAqi;
    dispatchEvent(new CustomEvent('wd:device-status', {detail:{voltage:2.77}})); await settle();
    console.assert(document.querySelector('.status-device').dataset.state === 'unknown', 'Unknown sensor status is not reporting');
    dispatchEvent(new CustomEvent('wd:device-status', {detail:{voltage:2.77,sensor_status:0}})); await settle();
    console.assert(document.querySelector('.status-device').dataset.state === 'reporting', 'Reported healthy sensors update the device card');
    dispatchEvent(new CustomEvent('wd:device-status', {detail:{voltage:2.2,sensor_status:0}})); await settle();
    console.assert(document.querySelector('.status-device').dataset.state === 'attention', 'Low battery stays visible on the device card');
    dispatchEvent(new CustomEvent('wd:device-status', {detail:{voltage:2.77,sensor_status:0}})); await settle();
    document.documentElement.dataset.fixture = 'ok';
  });
});
