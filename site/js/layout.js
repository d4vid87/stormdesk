// The Weather instruments have one protected arrangement on every device.
const KEY = 'wd.layout';
const old = localStorage.getItem(KEY);
if (old && localStorage.getItem('wd.layout.before-fixed') == null)
  localStorage.setItem('wd.layout.before-fixed', old);

export const NEVER_HIDE = ['severe', 'winter', 'tropical', 'alerts'];
export const TABS = { desk: 'desk-grid', data: 'data-grid', signals: 'signals-grid' };
const ORDER = ['g-rain', 'g-ltg', 'g-wind', 'g-wbgt', 'g-hum', 'g-uv', 'g-press', 'g-dew', 'g-wet'];
export const DEFAULT = Object.fromEntries(ORDER.map((id, order) => [id, { order }]));

export const panelIds = () => [...document.querySelectorAll('[data-panel]')].map((el) => el.dataset.panel);
export const tabOf = () => 'desk';
export const snapshot = () => structuredClone(DEFAULT);
export const hiddenPanels = () => [];
export const unhide = () => {};
export const setTab = () => {};
export const applyPlacement = () => {};
export const restore = () => initLayout();
export const resetLayout = () => initLayout();

export function initLayout() {
  document.body.classList.add('layout-locked');
  const grid = document.getElementById('desk-grid');
  if (grid && !document.getElementById('more-analysis')) {
    const more = document.createElement('details');
    more.id = 'more-analysis';
    more.innerHTML = '<summary>More weather analysis</summary><div id="more-analysis-content"></div>';
    grid.appendChild(more);
    const content = more.querySelector('div');
    for (const id of ['tenday', 'story', 'agree', 'changes', 'verify', 'sky', 'solar', 'lastyear', 'fire', 'health', 'aqi', 'nearby']) {
      const panel = grid.querySelector(`[data-panel="${id}"]`);
      if (panel) content.appendChild(panel);
    }
  }
  const gauges = document.getElementById('gauges');
  if (!gauges) return;
  for (const [index, id] of ORDER.entries()) {
    const gauge = gauges.querySelector(`[data-panel="${id}"]`);
    if (gauge) {
      gauge.classList.remove('panel-hidden');
      gauge.style.removeProperty('width');
      gauge.style.removeProperty('height');
      gauge.style.removeProperty('grid-column');
      if (gauges.children[index] !== gauge) gauges.insertBefore(gauge, gauges.children[index] || null);
    }
  }
}

if (location.search.includes('selftest')) {
  initLayout();
  console.assert([...document.querySelectorAll('#gauges > .gauge')].map((g) => g.dataset.panel).join() === ORDER.join(),
    'fixed layout: nine gauges keep their intended order');
  console.assert(!document.querySelector('#gauges .grip, #gauges .rz'), 'fixed layout: no drag or resize controls');
}
