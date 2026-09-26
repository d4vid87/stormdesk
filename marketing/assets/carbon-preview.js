const previews = {
  weather: ['images/stormdesk-dashboard.png', 'StormDesk weather dashboard with seven readings and clearly labeled North Texas demo data', 'Weather / Current conditions, seven readings, and up to ten forecast days. Captured demo data; not current conditions.'],
  radar: ['images/stormdesk-radar.png', 'StormDesk radar view powered by HookEcho', 'Radar / A focused HookEcho map with an official warning banner. Recorded interface; not live radar.'],
  history: ['images/stormdesk-data.png', 'StormDesk history view with temperature, rain, and wind charts', 'History / See the trend, compare readings, and explore your station archive. Recorded interface; not live readings.']
};
document.querySelectorAll('[data-preview]').forEach(button => button.addEventListener('click', () => {
  const [src, alt, caption] = previews[button.dataset.preview];
  const image = document.querySelector('#product-image');
  image.src = src;
  image.alt = alt;
  document.querySelector('#product-caption').textContent = caption;
  document.querySelectorAll('[data-preview]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
}));
