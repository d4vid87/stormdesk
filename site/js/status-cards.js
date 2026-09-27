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
    $('status-sunset').textContent = sky.Sunset && sky.Sunset !== '--' ? sky.Sunset : '—';
    $('status-golden').textContent = sky['Golden hour starts'] && sky['Golden hour starts'] !== '--' ? `Golden hour starts ${sky['Golden hour starts']}` : 'Golden hour unavailable';
    const m = moon();
    $('status-moon-icon').innerHTML = m.name === 'Full' ? '<span class="status-full-moon"></span>' : moonGlyph(m.age, 36);
    $('status-moon-phase').textContent = `${m.name}${m.name.toLowerCase().includes('moon') ? '' : ' moon'}`;
    $('status-moon-light').textContent = `${m.illum}% illuminated`;
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
