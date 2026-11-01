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
  console.assert(gauges.every(el => el.querySelector('.wx-orbit svg')), 'All eight readings default to Orbit Glass');
  console.assert(document.querySelector('#observatory-radar #gauges'), 'Gauges are integrated into radar');
  const stylePicker = document.getElementById('gauge-style');
  console.assert(stylePicker.options.length === 5, 'All five styles ship');
  const outlookButton = document.querySelector('[data-weather-view="outlook"]');
  const radarButton = document.querySelector('[data-weather-view="radar"]');
  outlookButton.click();
  console.assert(document.getElementById('desk').classList.contains('outlook-view') && document.getElementById('desk-radar').hidden, 'Outlook replaces radar');
  console.assert(!document.getElementById('desk-radar-frame').getAttribute('src'), 'Outlook unloads radar document');
  console.assert(!document.getElementById('outlook-astronomy').hidden && outlookButton.getAttribute('aria-pressed') === 'true', 'Outlook exposes astronomy and selected view');
  console.assert(JSON.parse(localStorage.getItem('wd.settings')).deskRadar === false && !document.getElementById('set-desk-radar').checked, 'View choice persists and syncs Settings');
  console.assert(document.getElementById('observatory-radar').getBoundingClientRect().height < 200, 'Radar off leaves no empty map area');
  radarButton.click();
  console.assert(!document.getElementById('desk-radar').hidden && document.getElementById('outlook-astronomy').hidden && radarButton.getAttribute('aria-pressed') === 'true', 'Radar view restores map');
  const rainBeforeStyle = document.querySelector('#g-rain .ginner b').textContent;
  for (const style of ['chrome','neon','dial','pixel','orbit']) {
    stylePicker.value = style; stylePicker.dispatchEvent(new Event('change'));
    console.assert(gauges.every(el => el.querySelector('.wx-' + style)), 'Style updates all live icons: ' + style);
    console.assert(JSON.parse(localStorage.getItem('wd.settings')).gaugeStyle === style, 'Style is saved: ' + style);
    console.assert(document.querySelector('#g-rain .ginner b').textContent === rainBeforeStyle, 'Style preserves readings');
  }
  console.assert(gauges.every(el => getComputedStyle(el.querySelector('.gwrap > span')).display !== 'none'), 'Instrument faces are visible');
  console.assert(document.getElementById('g-ltg').dataset.unavailable === 'false', 'Zero reported strikes is known data');
  console.assert(document.querySelector('#g-wet svg') && document.querySelector('#g-ltg svg'), 'Wet bulb and lightning have instrument faces');
  console.assert(document.getElementById('hero-alerts').parentElement.id === 'observatory-heading', 'Alert banner sits beside the clock');
  console.assert(/\d+:\d{2}/.test(document.getElementById('clock-time').textContent), 'Local clock shows hours and minutes');
  console.assert(document.querySelectorAll('#daycards > .daycard').length === 10, 'All ten available days render');
  const firstDay = document.querySelector('#daycards > .daycard');
  console.assert(firstDay.querySelector('.dc-temp b').textContent === '78°' && firstDay.querySelector('.dc-temp span').textContent === '58°', 'Clear list separates high and low without a slash');
  console.assert(firstDay.querySelector('.dc-pop').textContent === '0%', 'Clear list keeps rain chance uncluttered and preserves zero');
  console.assert(getComputedStyle(firstDay.querySelector('.dc-date')).display !== 'none' && document.querySelectorAll('.forecast-columns > span').length === 5, 'Clear list shows dates and labeled columns');
  console.assert(firstDay.getAttribute('aria-label').includes('high 78') || firstDay.getAttribute('aria-label').includes('High 78'), 'Forecast row describes its readings for screen readers');
  document.querySelector('#daycards > .daycard').click();
  console.assert(document.getElementById('forecast-dialog').open, 'Forecast day opens accessible details');
  document.getElementById('forecast-dialog').close();
  console.assert(['severe','winter','tropical','alerts'].every(id => document.querySelector(`#observatory-signals [data-panel="${id}"]`)), 'Safety cards stay outside collapsed analysis');
  dispatchEvent(new CustomEvent('wd:forecast', { detail: { current_conditions: {}, forecast: { daily: [{}], hourly: [] } } }));
  console.assert(document.querySelector('#daycards .dc-pop').textContent === '—', 'Unavailable rain chance is not zero');
  console.assert(document.querySelector('#g-ltg').textContent.includes('unavailable'), 'Missing lightning is unavailable, not no strikes');
  console.assert(document.querySelector('#g-wet').dataset.unavailable === 'true', 'Missing wet bulb hides its needle');
  console.assert(document.querySelector('#g-rain').dataset.unavailable === 'true', 'Missing rain is not dry');
  console.assert(document.querySelector('#g-rain .wx-unavailable'), 'Missing rain has a muted, stationary icon');
  console.assert(!document.querySelector('#g-rain .fi-fill, #g-dew .fi-needle, #g-wbgt .fi-fill'), 'Unavailable values have no filled instrument indicators');
  dispatchEvent(new CustomEvent('wd:forecast', { detail: fc }));
  dispatchEvent(new CustomEvent('wd:alerts', { detail: [{ properties: {
    event: '<b>Test advisory</b>', severity: 'Severe', description: '<img src=x onerror=alert(1)>',
  } }] }));
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
    // These checks await MutationObserver updates, not animation frames, which headless virtual time can starve.
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));
    await settle();
    console.assert(['observatory-signals','advanced-outlook','activity-planner'].every(id => getComputedStyle(document.getElementById(id)).display === 'none'), 'Removed sections no longer appear on Weather');
    console.assert(getComputedStyle(document.getElementById('daycards')).display === 'grid', 'Forecast uses glass tile layout');
    console.assert(getComputedStyle(document.querySelector('#daycards .dc-cond')).display !== 'none', 'Forecast tiles show condition labels');
    console.assert(getComputedStyle(document.querySelector('#daycards > .daycard')).gridColumnEnd === '-1', 'Today card spans the tile grid on small screens too');
    console.assert(document.querySelector('#outlook-moon-orb svg') && document.querySelectorAll('.twilight-card').length === 3, 'Astronomy renders a moon phase and three twilight cards');
    const animatedSky = document.documentElement.dataset.motion === 'full' && matchMedia('(prefers-reduced-motion: no-preference)').matches;
    console.assert((getComputedStyle(document.querySelector('.solar-trace')).animationName !== 'none') === animatedSky, 'Sky animation respects motion preference');
    const skySource = document.getElementById('sky');
    console.assert(['Sunrise','Sunset','Astronomical dawn','Astronomical dusk','Moonrise','Moonset'].every(label => skySource.textContent.includes(label)), 'Astronomy includes sun, twilight and moon events');
    console.assert(document.getElementById('outlook-sky-times').textContent === skySource.textContent.replaceAll('--','—'), 'Outlook mirrors current astronomy readings');
    console.assert(document.querySelector('[data-sky-value="Sunrise"]').textContent !== '—', 'Sunrise is promoted into the solar scene');
    const savedSky = skySource.innerHTML;
    skySource.innerHTML = '<div>Sun and twilight times unavailable for this location</div>';
    await settle();
    console.assert(document.getElementById('outlook-sky-times').textContent === skySource.textContent, 'Unavailable source replaces old astronomy times with an explanation');
    console.assert([...document.querySelectorAll('[data-sky-value]')].every(el => el.textContent === '—'), 'Missing astronomy clears every visual reading');
    skySource.innerHTML = savedSky;
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
