const previews = {
  weather: ['images/stormdesk-4110-weather.jpg', 'StormDesk 4.11.0 Observatory with Sky Theater forecasts and Weather Changes; illustrative model weather', 'StormDesk 4.11.0 demo weather, captured November 17, 2026; illustrative, not current weather.'],
  radar: ['images/stormdesk-4110-radar.jpg', 'StormDesk 4.11.0 with recorded HookEcho MRMS radar over Florida and the Gulf', 'Radar / StormDesk 4.11.0. HookEcho MRMS over Florida and the Gulf, captured November 17, 2026. Separate from the Fort Worth demo readings; recorded, not live radar.'],
  history: ['images/stormdesk-4110-history.jpg', 'StormDesk 4.11.0 history view with temperature, rain, and wind charts', 'History / StormDesk 4.11.0. Demo station observations captured November 17, 2026; illustrative, not live readings.']
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
