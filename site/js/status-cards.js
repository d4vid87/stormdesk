// Summarize the existing live render targets; keep their full content in native dialogs.
import { moon, moonGlyph } from './sky.js';
const $ = id => document.getElementById(id);
export function initStatusCards(signals) {
  signals.querySelector('h2').textContent = 'Local signals';
  const sources = Object.fromEntries(['aqi','sky','health'].map(id => [id, signals.querySelector(`[data-panel="${id}"]`)]));
  const dialog = document.createElement('dialog');
  dialog.id = 'signal-details';
  dialog.setAttribute('aria-labelledby', 'signal-details-title');
  dialog.innerHTML = '<form method="dialog"><button aria-label="Close details">×</button></form><h2 id="signal-details-title"></h2>';
  for (const source of Object.values(sources)) { source.hidden = true; dialog.append(source); }
  document.body.append(dialog);
  const tiles = document.createElement('div');
  tiles.className = 'status-tiles';
  tiles.innerHTML = `<button class="status-tile status-air" data-signal-detail="aqi"><span class="status-label">≋ Air quality</span><strong id="status-aqi">—</strong><span id="status-aqi-label">Waiting for data</span><span class="status-meter" aria-hidden="true"><i></i></span></button>
    <button class="status-tile status-moon" data-signal-detail="sky"><span class="status-label">Moon</span><span id="status-moon-icon" aria-hidden="true"></span><strong id="status-moon-phase">—</strong><small id="status-moon-light">Waiting for data</small></button>
    <button class="status-tile status-sun" data-signal-detail="sky"><span class="status-label">☀ Sun & daylight</span><strong id="status-sunset">—</strong><span>Sunset · local time</span><svg class="status-sun-curve" viewBox="0 0 240 70" aria-hidden="true"><path d="M10 60H230"/><path d="M15 60Q120-45 225 60"/></svg><small id="status-golden">Sun times unavailable</small></button>`;
  const device = document.createElement('button');
  device.className = 'status-device';
  device.dataset.signalDetail = 'health';
  device.innerHTML = '<span aria-hidden="true">⌁</span><span><strong id="status-device-title">Device health unavailable</strong><small id="status-device-copy">View connection details</small></span><i aria-hidden="true"></i>';
  signals.insertBefore(tiles, $('observatory-local'));
  signals.append(device);
  const astronomy = document.createElement('section');
  astronomy.id = 'outlook-astronomy';
  astronomy.className = 'card';
  astronomy.hidden = true;
  astronomy.setAttribute('aria-labelledby', 'outlook-astronomy-title');
  astronomy.innerHTML = `<div class="sky-heading"><div><span class="sky-eyebrow">THE SKY ABOVE</span><h2 id="outlook-astronomy-title">Sun, moon &amp; twilight</h2></div><span class="sky-live">Today</span></div>
    <div class="solar-scene">
      <div class="solar-haze" aria-hidden="true"></div>
      <svg class="solar-orbit" viewBox="0 0 480 210" aria-hidden="true"><path class="solar-track" d="M35 180 A205 155 0 0 1 445 180"/><path class="solar-trace" d="M35 180 A205 155 0 0 1 445 180"/><path class="solar-horizon" d="M20 180H460"/><circle class="solar-star" cx="240" cy="25" r="13"/><g class="solar-rays"><path d="M240 2V7M240 43V48M217 25H222M258 25H263M224 9L228 13M252 37L256 41M224 41L228 37M252 13L256 9"/></g></svg>
      <div class="solar-duration"><span>DAYLIGHT</span><strong data-sky-value="Daylight">—</strong><small>Tomorrow <span data-sky-value="Tomorrow">—</span></small></div>
      <div class="sun-events"><div><span>↗ SUNRISE</span><strong data-sky-value="Sunrise">—</strong></div><div><span>↘ SUNSET</span><strong data-sky-value="Sunset">—</strong></div></div>
    </div>
    <div class="lunar-scene"><div class="lunar-stars" aria-hidden="true"></div><div id="outlook-moon-orb" aria-hidden="true"></div><div class="lunar-copy"><span class="sky-eyebrow">TONIGHT'S MOON</span><h3 id="outlook-moon-phase">—</h3><p id="outlook-moon-light"></p><p id="outlook-moon-next"></p></div></div>
    <div class="moon-events"><div><span>MOONRISE</span><strong data-sky-value="Moonrise">—</strong></div><div><span>MOONSET</span><strong data-sky-value="Moonset">—</strong></div><div><span>GOLDEN HOUR</span><strong data-sky-value="Golden hour starts">—</strong></div></div>
    <div class="twilight-heading"><h3>The edges of daylight</h3><span>Dawn / dusk</span></div>
    <div class="twilight-cards">${['Civil','Nautical','Astronomical'].map((name,i) => `<div class="twilight-card twilight-${i}"><i aria-hidden="true"></i><span>${name}</span><strong data-sky-value="${name} dawn">—</strong><small data-sky-value="${name} dusk">—</small></div>`).join('')}</div>
    <details class="sky-details"><summary>All sun &amp; moon times</summary><div class="kv-rows" id="outlook-sky-times"></div></details>
    <p class="sky-footnote">Device local time · twilight &amp; moon phase are estimates.<br>— means unavailable or no event. Sun arc is illustrative.</p>`;
  signals.before(astronomy);
  signals.addEventListener('click', e => {
    const button = e.target.closest('[data-signal-detail]');
    if (!button) return;
    const kind = button.dataset.signalDetail;
    $('signal-details-title').textContent = {aqi:'Air quality',sky:'Sun & moon times',health:'Device health'}[kind];
    for (const [id, source] of Object.entries(sources)) source.hidden = id !== kind;
    dialog.showModal();
  });
  const rows = id => Object.fromEntries([...$(id).children].filter(row => row.children.length === 2).map(row => [row.firstElementChild.textContent, row.lastElementChild.textContent]));
  function update() {
    const aqi = $('aqi-val');
    $('status-aqi').textContent = aqi.textContent === '--' ? '—' : aqi.textContent;
    $('status-aqi').className = aqi.className;
    const value = Number(aqi.textContent.trim());
    const known = aqi.textContent.trim() !== '' && Number.isFinite(value) && value >= 0;
    $('status-aqi-label').textContent = known ? $('aqi-label').textContent : 'Reading unavailable';
    tiles.querySelector('.status-meter i').style.width = `${known ? Math.min(value / 500, 1) * 100 : 0}%`;
    tiles.querySelector('.status-air').dataset.band = aqi.className;
    const sky = rows('sky');
    for (const field of astronomy.querySelectorAll('[data-sky-value]')) {
      const value = sky[field.dataset.skyValue];
      field.textContent = value && value !== '--' ? value : '—';
    }
    $('outlook-sky-times').replaceChildren(...[...$('sky').children].map(row => row.cloneNode(true)));
    for (const value of $('outlook-sky-times').querySelectorAll('span:last-child')) if (value.textContent === '--') value.textContent = '—';
    $('status-sunset').textContent = sky.Sunset && sky.Sunset !== '--' ? sky.Sunset : '—';
    $('status-golden').textContent = sky['Golden hour starts'] && sky['Golden hour starts'] !== '--' ? `Golden hour starts ${sky['Golden hour starts']}` : 'Golden hour unavailable';
    const m = moon();
    $('status-moon-icon').innerHTML = m.name === 'Full' ? '<span class="status-full-moon"></span>' : moonGlyph(m.age, 36);
    $('status-moon-phase').textContent = `${m.name}${m.name.toLowerCase().includes('moon') ? '' : ' moon'}`;
    $('status-moon-light').textContent = `${m.illum}% illuminated`;
    $('outlook-moon-phase').textContent = m.name;
    $('outlook-moon-light').textContent = `${m.illum}% illuminated`;
    $('outlook-moon-next').textContent = `Next ${m.nextName.toLowerCase()} · around ${m.nextDate.toLocaleDateString([], {month:'short',day:'numeric'})}`;
    const orb = $('outlook-moon-orb');
    const phase = `${m.name}-${m.illum}`;
    if (orb.dataset.phase !== phase) {
      orb.dataset.phase = phase;
      orb.innerHTML = moonGlyph(m.age, 100);
    }
    const health = rows('health'), failure = $('health').querySelector('.fail');
    device.dataset.state = failure ? 'attention' : health.Sensors ? 'reporting' : 'unknown';
    $('status-device-title').textContent = failure ? 'Station needs attention' : health.Sensors ? 'Station sensors reporting' : 'Device health unavailable';
    $('status-device-copy').textContent = failure ? failure.textContent : health['Last report'] ? `Last report ${health['Last report']}` : health.Battery ? `Battery ${health.Battery} · view details` : 'View connection details';
  }
  // The sources refresh independently (AQI, astronomy, UDP health). Observe only those
  // render targets, not our summaries, so there is no polling or observer feedback loop.
  const observer = new MutationObserver(update);
  for (const id of ['aqi-val','aqi-label','sky','health','hero-moon']) observer.observe($(id), {subtree:true,childList:true,characterData:true});
  update();
}
