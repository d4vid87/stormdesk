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
  console.assert(document.querySelector('#settings-basics #btn-voice-test') && document.querySelector('#settings-basics #voice-status'), 'Voice test and status stay beside the speech setting');
  dispatchEvent(new CustomEvent('wd:forecast', { detail: fc }));
  // Storm watch shares the same feed; missing readings must not become reassuring zeroes.
  const pressureCard = document.querySelector('[data-panel="g-press"]');
  console.assert(getComputedStyle(pressureCard).display !== 'none', 'Observatory shows pressure in the seven-reading rail');
  const gauges = [...document.querySelectorAll('#gauges > .gauge')].filter(el => getComputedStyle(el).display !== 'none');
  console.assert(gauges.length === 7, 'Observatory overview has exactly seven readings');
  console.assert(document.querySelector('#g-wet svg') && document.querySelector('#g-ltg svg'), 'Wet bulb and lightning have instrument faces');
  console.assert(document.getElementById('hero-alerts').parentElement.id === 'observatory-heading', 'Alert banner sits beside the clock');
  console.assert(/\d+:\d{2}/.test(document.getElementById('clock-time').textContent), 'Local clock shows hours and minutes');
  console.assert(document.querySelectorAll('#daycards > .daycard').length === 10, 'All ten available days render');
  document.querySelector('#daycards > .daycard').click();
  console.assert(document.getElementById('forecast-dialog').open, 'Forecast day opens accessible details');
  document.getElementById('forecast-dialog').close();
  console.assert(['severe','winter','tropical','alerts'].every(id => document.querySelector(`#observatory-signals [data-panel="${id}"]`)), 'Safety cards stay outside collapsed analysis');
  dispatchEvent(new CustomEvent('wd:forecast', { detail: { current_conditions: {}, forecast: { daily: [{}], hourly: [] } } }));
  console.assert(document.querySelector('#g-ltg').textContent.includes('unavailable'), 'Missing lightning is unavailable, not no strikes');
  console.assert(document.querySelector('#g-wet').dataset.unavailable === 'true', 'Missing wet bulb hides its needle');
  console.assert(document.querySelector('#g-rain').dataset.unavailable === 'true', 'Missing rain is not dry');
  dispatchEvent(new CustomEvent('wd:forecast', { detail: fc }));
  dispatchEvent(new CustomEvent('wd:alerts', { detail: [{ properties: {
    event: '<b>Test advisory</b>', severity: 'Severe', description: '<img src=x onerror=alert(1)>',
  } }] }));
  dispatchEvent(new CustomEvent('wd:alerts', { detail: [] }));
  // api.OBS order: time, temp, rh, press, ... — index by name off the module the page already
  // loaded rather than hard-coding a shape that moves.
  import('./js/api.js').then(({ OBS }) => {
    const o = [];
    o[OBS.time] = now; o[OBS.temp] = 22.4; o[OBS.rh] = 68; o[OBS.press] = 993.1;
    o[OBS.windAvg] = 3.2; o[OBS.windGust] = 6.5; o[OBS.windDir] = 190;
    o[OBS.uv] = 4; o[OBS.solar] = 520; o[OBS.dayRain] = 3; o[OBS.battery] = 2.71;
    dispatchEvent(new CustomEvent('wd:ws-obs', { detail: o }));
    console.assert(document.getElementById('observatory-local').textContent.includes('gusts'), 'Local signals refresh with station observations');
    document.documentElement.dataset.fixture = 'ok';
  });
});
