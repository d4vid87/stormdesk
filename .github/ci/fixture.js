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
  precip_accum: i % 3 === 1 ? 0.28 : 0,
  wind_avg: 6 + i % 5,
  sunrise: day + i * 86400 + 6 * 3600 + 40 * 60,
  sunset: day + i * 86400 + 19 * 3600 + 50 * 60,
}));

const hourly = Array.from({ length: 72 }, (_, i) => ({
  time: now - 3600 + i * 3600,
  air_temperature: 70 + 8 * Math.sin(i / 4),
  feels_like: 70 + 8 * Math.sin(i / 4),
  relative_humidity: 55 + (i % 20),
  cloud_cover: 40 + i % 50,
  precip_probability: (i * 7) % 90,
  precip: (i % 9 === 0) ? 0.02 : 0,
  precip_period: 'preceding-hour', precip_source: 'Synthetic CI fixture',
  visibility: i > 3 && i < 7 ? 800 : 10000,
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
    cloud_cover: 64, cloud_base_estimate: 780, freezing_level: 3780,
    air_density: 1.18, wet_bulb_temperature: 65.8, lightning_strike_count_last_3hr: 0,
  },
  forecast: { daily, hourly },
};

addEventListener('load', () => {
  document.documentElement.dataset.fixtureStage = 'controls';
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
  const styleDialog = document.getElementById('gauge-style-dialog');
  const styleChoices = [...styleDialog.querySelectorAll('[data-gauge-style]')];
  console.assert(styleChoices.length === 5 && styleChoices.every(button => button.querySelectorAll('.wx-icon').length === 2), 'All five styles have live icon previews');
  stylePicker.click();
  console.assert(styleDialog.open && styleDialog.querySelector('[aria-pressed=true]').dataset.gaugeStyle === 'orbit', 'Chooser opens with saved default selected');
  console.assert(styleDialog.getBoundingClientRect().width <= innerWidth && styleDialog.getBoundingClientRect().height <= innerHeight, 'Style chooser fits the viewport');
  styleDialog.querySelector('[aria-label="Close gauge styles"]').click();
  console.assert(!styleDialog.open, 'Style chooser closes without changing the style');
  const outlookButton = document.querySelector('[data-weather-view="outlook"]');
  const radarButton = document.querySelector('[data-weather-view="radar"]');
  outlookButton.click();
  console.assert(document.getElementById('desk').classList.contains('outlook-view') && document.getElementById('desk-radar').hidden, 'Outlook replaces radar');
  console.assert(!document.getElementById('desk-radar-frame').getAttribute('src'), 'Outlook unloads radar document');
  console.assert(!document.getElementById('outlook-astronomy').hidden && outlookButton.getAttribute('aria-pressed') === 'true', 'Outlook exposes astronomy and selected view');
  console.assert(JSON.parse(localStorage.getItem('wd.settings')).deskRadar === false && !document.getElementById('set-desk-radar').checked, 'View choice persists and syncs Settings');
  console.assert(document.getElementById('observatory-radar').getBoundingClientRect().height <= document.getElementById('radar-shelf').getBoundingClientRect().height + 2, 'Radar off leaves only the gauges, without an empty map area');
  console.assert(document.querySelectorAll('#forecast-hourly .fd-hour').length > 0, 'Forecast desk shows live hourly data');
  const sidebarOrder = [...document.getElementById('forecast-sidebar').children].map(el => el.id);
  console.assert(sidebarOrder.join(',') === 'forecast-precip,outlook-astronomy', 'Precipitation and astronomy share the hourly sidebar');
  console.assert(['forecast-insights','forecast-hazards','forecast-environment'].every(id => document.getElementById(id)), 'Forecast context, hazards and environment mount once');
  console.assert(/\d+:\d{2}:\d{2}/.test(document.getElementById('clock-time').textContent), 'Clock includes seconds');
  radarButton.click();
  console.assert(!document.getElementById('desk-radar').hidden && document.getElementById('outlook-astronomy').hidden && radarButton.getAttribute('aria-pressed') === 'true', 'Radar view restores map');
  const rainBeforeStyle = document.querySelector('#g-rain .ginner b').textContent;
  for (const style of ['chrome','neon','dial','pixel','orbit']) {
    stylePicker.click();
    styleChoices.find(button => button.dataset.gaugeStyle === style).click();
    console.assert(!styleDialog.open && styleDialog.querySelector('[aria-pressed=true]').dataset.gaugeStyle === style, 'Choosing a style closes the dialog and updates selection');
    console.assert(document.activeElement === stylePicker && stylePicker.querySelector('.wx-' + style), 'Focus and current preview return to the chooser button');
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
  console.assert(firstDay.tagName === 'BUTTON' && firstDay.tabIndex === 0, 'Forecast days are native keyboard controls');
  firstDay.focus({preventScroll:true}); firstDay.click();
  const forecastDialog = document.getElementById('forecast-dialog');
  console.assert(forecastDialog.open && forecastDialog.contains(document.activeElement), 'Forecast day opens modal details with focus inside');
  console.assert(document.getElementById(forecastDialog.getAttribute('aria-labelledby'))?.textContent, 'Forecast details have an accessible title');
  forecastDialog.close();
  console.assert(document.activeElement === firstDay, 'Closing forecast details returns focus to the selected day');
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
    outlookButton.click(); await settle();
    const contexts = [...document.querySelectorAll('#balanced-contexts > .balanced-card')];
    console.assert(contexts.length === 4 && contexts.every(card => getComputedStyle(card).display !== 'none'), 'All four Balanced context cards remain visible');
    const balancedDialog = document.getElementById('balanced-dialog');
    for (const [label, selector] of [
      ['Hazards & atmosphere details', '#forecast-hazards'],
      ['Air & ground details', '#forecast-environment'],
      ['River forecast details', null],
      ['Winter impact details', null],
      ['Forecast changes & normals', '#forecast-insights'],
      ['Hourly detail', '.fd-hour-timeline'],
      ['Sun & moon details', '.sky-details'],
    ]) {
      const button = [...document.querySelectorAll('#desk button')].find(el => el.getAttribute('aria-label') === label || el.textContent.trim() === label);
      const source = selector && document.querySelector(selector), home = source?.parentElement;
      console.assert(button?.tagName === 'BUTTON' && button.tabIndex === 0, label + ' is a named keyboard control');
      button.focus({preventScroll:true}); button.click();
      console.assert(balancedDialog.open && balancedDialog.contains(document.activeElement), label + ' opens a modal with focus inside');
      console.assert(document.getElementById(balancedDialog.getAttribute('aria-labelledby'))?.textContent, label + ' has an accessible dialog title');
      console.assert(balancedDialog.getBoundingClientRect().width <= innerWidth && balancedDialog.getBoundingClientRect().height <= innerHeight, label + ' fits the viewport');
      if (source) console.assert(balancedDialog.contains(source), label + ' exposes the original live source');
      if (selector === '.fd-hour-timeline') {
        source.open = true; source.dispatchEvent(new Event('toggle'));
        console.assert(source.querySelectorAll('.fd-weather-table tbody tr').length > 20, 'Every hour is available beyond the three-hour overview');
        console.assert(source.textContent.includes('Running total'), 'Precipitation timeline identifies its accumulation period');
        console.assert(source.querySelector('.fd-weather-table thead').textContent.includes('Visibility'), 'Hourly detail retains visibility for every hour');
        source.open = false;
      }
      const nested = source?.querySelector('details'); if (nested) nested.open = true;
      balancedDialog.close(); await settle();
      if (nested) console.assert(!nested.open, label + ' collapses nested details so their next toggle refreshes data');
      console.assert(!balancedDialog.open && document.activeElement === button, label + ' returns focus to its trigger');
      if (source) console.assert(source.parentElement === home && source.closest('#balanced-details'), label + ' restores its live source after closing');
    }
    const aqi = document.getElementById('aqi-val'), oldAqi = aqi.textContent;
    aqi.textContent = '--'; await settle();
    console.assert(document.getElementById('status-aqi-label').textContent === 'Reading unavailable' && document.querySelector('#balanced-air .balanced-reading').textContent === 'Air quality unavailable', 'Missing AQI never shows Good in the shared source or Balanced card');
    aqi.textContent = oldAqi;
    dispatchEvent(new CustomEvent('wd:device-status', {detail:{voltage:2.77}})); await settle();
    console.assert(document.querySelector('.status-device').dataset.state === 'unknown', 'Unknown sensor status is not reporting');
    dispatchEvent(new CustomEvent('wd:device-status', {detail:{voltage:2.77,sensor_status:0}})); await settle();
    console.assert(document.querySelector('.status-device').dataset.state === 'reporting', 'Reported healthy sensors update the device card');
    dispatchEvent(new CustomEvent('wd:device-status', {detail:{voltage:2.2,sensor_status:0}})); await settle();
    console.assert(document.querySelector('.status-device').dataset.state === 'attention', 'Low battery stays visible on the device card');
    dispatchEvent(new CustomEvent('wd:device-status', {detail:{voltage:2.77,sensor_status:0}})); await settle();
    outlookButton.click();
    document.documentElement.dataset.fixtureStage = 'fonts';
    // FontFaceSet.ready also waits for layout, which headless virtual time can starve.
    let fontTimeout;
    const loadedFonts = await Promise.race([
      Promise.all([500, 600].map(weight => document.fonts.load(`${weight} 16px "Barlow SC"`))).catch(() => []),
      new Promise(resolve => { fontTimeout = setTimeout(() => resolve([]), 3000); }),
    ]);
    clearTimeout(fontTimeout);
    const fontsReady = loadedFonts.length === 2 && loadedFonts.every(faces => faces.length > 0 && faces.every(face => face.status === 'loaded'));
    console.assert(fontsReady, 'Both bundled Barlow SC font weights load before layout checks (3-second limit)');
    if (!fontsReady) return;
    document.documentElement.dataset.fixtureStage = 'layout';
    await settle();
    const desk = document.getElementById('desk');
    const temperatureType = getComputedStyle(document.getElementById('hero-temp'));
    const clockType = getComputedStyle(document.getElementById('clock-time'));
    console.assert(temperatureType.fontSize === clockType.fontSize && temperatureType.fontWeight === clockType.fontWeight && Number(temperatureType.fontWeight) >= 700, 'Temperature matches the bold clock at every screen size');
    console.assert([...document.querySelectorAll('body > header nav .tab, body > header #btn-settings, .weather-view button')].every(button => {
      const box = button.getBoundingClientRect();
      return box.width > 0 && box.left >= 0 && box.right <= innerWidth + 1 && button.querySelector('svg[aria-hidden="true"]');
    }), 'Navigation, Settings and view buttons stay visible with decorative vector icons');
    const thumbnails = [...document.querySelectorAll('#daycards .dc-icon img, #forecast-hourly .fd-icon img, #forecast-precip .fd-icon img')];
    console.assert(thumbnails.length >= 10 && thumbnails.every(img => img.getAttribute('src').includes('icons/static/')), 'Forecast thumbnails do not run separate SVG animation timelines');
    console.assert((getComputedStyle(document.querySelector('#daycards .dc-icon')).animationName !== 'none') === animatedSky, 'Forecast cards retain motion without animated SVG documents');
    console.assert((getComputedStyle(document.querySelector('.fd-hour[aria-pressed="true"] .fd-icon')).animationName !== 'none') === animatedSky, 'Selected hour animation respects motion preference');
    console.assert(desk.scrollWidth <= desk.clientWidth + 1, 'Forecast desk stays within the browser width');
    if (innerWidth >= 1200 && innerHeight >= 900) {
      const bounds = id => document.getElementById(id).getBoundingClientRect();
      const grid = bounds('observatory-grid'), forecast = bounds('observatory-forecast');
      const hourly = bounds('forecast-hourly'), sidebar = bounds('forecast-sidebar'), context = bounds('balanced-contexts');
      const days = [...document.querySelectorAll('#daycards > .daycard')].map(card => card.getBoundingClientRect());
      const readings = gauges.map(gauge => gauge.getBoundingClientRect());
      const cards = contexts.map(card => card.getBoundingClientRect());
      console.assert(days.every(day => Math.abs(day.top - days[0].top) < 2), 'All ten forecast days share one desktop row');
      console.assert([...document.querySelectorAll('#daycards .dc-pop')].every(label => label.getBoundingClientRect().height >= 10), 'Every forecast rain chance retains readable height');
      console.assert(readings.every(reading => Math.abs(reading.top - readings[0].top) < 2), 'All eight readings share one desktop row');
      console.assert([forecast, context].every(row => Math.abs(row.left - grid.left) < 2 && Math.abs(row.right - grid.right) < 2), 'Forecast and context rows span the desk');
      console.assert(forecast.top >= Math.max(...readings.map(reading => reading.bottom)) - 1, 'Forecast follows the readings without overlap');
      console.assert(hourly.top >= forecast.bottom - 1 && sidebar.top >= forecast.bottom - 1 && hourly.right <= sidebar.left + 1, 'Hourly sits left of precipitation and sky below the forecast');
      console.assert(context.top >= Math.max(hourly.bottom, sidebar.bottom) - 1 && cards.every(card => Math.abs(card.top - cards[0].top) < 2), 'Four context cards share the bottom row without overlap');
      console.assert(context.bottom <= innerHeight + 1, 'Every context card remains above the fold');
      console.assert(desk.scrollHeight <= desk.clientHeight + 2 && document.documentElement.scrollHeight <= innerHeight + 2 && document.body.scrollHeight <= innerHeight + 2, 'Balanced desktop needs no page or desk scrolling');
    } else if (innerWidth <= 1100 || innerHeight < 900) {
      console.assert(document.documentElement.scrollWidth <= innerWidth + 1, 'Narrow and short screens reflow without horizontal page overflow');
      console.assert(document.documentElement.scrollHeight > innerHeight || desk.scrollHeight > desk.clientHeight, 'Narrow and short screens allow vertical scrolling for all content');
    }
    document.documentElement.dataset.fixtureStage = 'complete';
    document.documentElement.dataset.fixture = 'ok';
  });
});
