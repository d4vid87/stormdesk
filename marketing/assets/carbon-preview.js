const previews = {
  weather: ['images/stormdesk-4121-weather.jpg', 'StormDesk 4.12.1 Observatory with Sky Theater forecasts and Weather Changes; illustrative demo weather', 'StormDesk 4.12.1 demo weather, captured November 18, 2026; illustrative, not current weather.'],
  radar: ['images/stormdesk-4121-radar.jpg', 'StormDesk 4.12.1 with recorded HookEcho KFWS radar near Fort Worth', 'Radar / StormDesk 4.12.1. HookEcho KFWS near Fort Worth, captured November 18, 2026 around 2:58 PM CST. Separate from the demo readings; recorded, not live radar.'],
  history: ['images/stormdesk-4121-history.jpg', 'StormDesk 4.12.1 history view with temperature, rain, and wind charts', 'History / StormDesk 4.12.1. Demo station observations captured November 18, 2026; illustrative, not live readings.'],
  customize: ['images/stormdesk-4121-layout-picker.jpg', 'StormDesk 4.12.1 Customize desk layout controls for navigation and weather panels', 'Customize / StormDesk 4.12.1. Layout controls and local screen preferences, captured November 18, 2026 with demo weather.'],
  arrange: ['images/stormdesk-4121-layout-editor.jpg', 'StormDesk 4.12.1 controls for arranging navigation, gauges, headers, and weather panels', 'Arrange / StormDesk 4.12.1. Move gauges, menus and panels to suit your screen; captured November 18, 2026 with demo weather.']
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
