const previews = {
  weather: ['images/stormdesk-461-weather.jpg', 'StormDesk 4.6.1 with Orbit Glass gauges above HookEcho radar and labeled demo station data', 'Weather / Orbit Glass gauges above the full HookEcho viewer. Sample station data; radar captured October 31, 2026.'],
  radar: ['images/stormdesk-461-radar.jpg', 'StormDesk radar view powered by HookEcho', 'Radar / A focused HookEcho map with an official warning banner. Recorded interface; not live radar.'],
  history: ['images/stormdesk-461-history.jpg', 'StormDesk history view with temperature, rain, and wind charts', 'History / See the trend, compare readings, and explore your station archive. Recorded interface; not live readings.']
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
