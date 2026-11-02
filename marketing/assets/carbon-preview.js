const previews = {
  weather: ['images/stormdesk-4100-balanced.jpg', 'StormDesk 4.10.0 Balanced Desk with Orbit Glass gauges, aligned forecasts and illustrative weather data', 'Balanced Desk · demo station readings; forecast and regional data shown for illustration. Captured November 1, 2026. Not current weather.'],
  radar: ['images/stormdesk-461-radar.jpg', 'StormDesk 4.6.1 radar view powered by HookEcho', 'Radar / StormDesk 4.6.1. A focused HookEcho map with an official warning banner. Recorded interface; not live radar.'],
  history: ['images/stormdesk-461-history.jpg', 'StormDesk 4.6.1 history view with temperature, rain, and wind charts', 'History / StormDesk 4.6.1. See the trend, compare readings, and explore your station archive. Recorded interface; not live readings.']
};
document.querySelectorAll('[data-preview]').forEach(button => button.addEventListener('click', () => {
  const [src, alt, caption] = previews[button.dataset.preview];
  const image = document.querySelector('#product-image');
  image.src = src;
  image.alt = alt;
  document.querySelector('#product-full').href = src;
  document.querySelector('#product-caption').textContent = caption;
  document.querySelectorAll('[data-preview]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
}));
