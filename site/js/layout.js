import { initObservatory } from './observatory.js';
import { load, store } from './app.js';
// Only gauge order is customizable; the radar workspace keeps its protected structure.
const KEY = 'wd.layout';
const old = localStorage.getItem(KEY);
if (old && localStorage.getItem('wd.layout.before-fixed') == null)
  localStorage.setItem('wd.layout.before-fixed', old);

export const NEVER_HIDE = ['severe', 'winter', 'tropical', 'alerts'];
export const TABS = { desk: 'desk-grid', data: 'data-grid', signals: 'signals-grid' };
const ORDER = ['g-rain', 'g-ltg', 'g-wind', 'g-wbgt', 'g-uv', 'g-press', 'g-hum', 'g-dew'];
export const DEFAULT = Object.fromEntries(ORDER.map((id, order) => [id, { order }]));
const ORDER_KEY = 'wd.gaugeOrder';
const savedOrder = load(ORDER_KEY, ORDER);
let order = [...new Set([...(Array.isArray(savedOrder) ? savedOrder : []).filter(id => ORDER.includes(id)), ...ORDER])];

export const panelIds = () => [...document.querySelectorAll('[data-panel]')].map((el) => el.dataset.panel);
export const tabOf = () => 'desk';
export const snapshot = () => Object.fromEntries(order.map((id, index) => [id, { order: index }]));
export const hiddenPanels = () => [];
export const unhide = () => {};
export const setTab = () => {};
export const applyPlacement = () => {};
export const restore = state => {
  if (ORDER.some(id => Number.isFinite(state?.[id]?.order))) {
    order = [...ORDER].sort((a, b) => (Number.isFinite(state?.[a]?.order) ? state[a].order : Infinity)
      - (Number.isFinite(state?.[b]?.order) ? state[b].order : Infinity));
    store(ORDER_KEY, order);
  }
  initLayout();
};
export const resetLayout = () => restore(DEFAULT);

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
  initObservatory();
  const gauges = document.getElementById('gauges');
  if (!gauges) return;
  for (const [index, id] of order.entries()) {
    const gauge = gauges.querySelector(`[data-panel="${id}"]`);
    if (gauge) {
      gauge.classList.remove('panel-hidden');
      gauge.style.removeProperty('width');
      gauge.style.removeProperty('height');
      gauge.style.removeProperty('grid-column');
      gauge.setAttribute('aria-description', 'Drag the title to reorder, or press Alt + Left or Right arrow. Enter opens measurement details.');
      gauge.querySelector('h3').title = 'Drag to reorder · Alt + ← / → when this gauge is focused';
      if (gauges.children[index] !== gauge) gauges.insertBefore(gauge, gauges.children[index] || null);
    }
  }
  initGaugeMoves(gauges);
}

function initGaugeMoves(gauges) {
  if (gauges.dataset.reorderReady) return;
  gauges.dataset.reorderReady = 'true';
  const status = document.createElement('span');
  status.className = 'gauge-order-status';
  status.setAttribute('role', 'status');
  gauges.after(status);
  const move = (gauge, target) => {
    const from = order.indexOf(gauge.dataset.panel), to = order.indexOf(target.dataset.panel);
    if (from < 0 || to < 0 || from === to) return;
    order.splice(to, 0, order.splice(from, 1)[0]);
    gauges.insertBefore(gauge, from < to ? target.nextSibling : target);
    store(ORDER_KEY, order);
    gauge.focus({ preventScroll: true });
    status.textContent = `${gauge.querySelector('h3').textContent} moved to position ${to + 1} of ${order.length}`;
  };
  let drag;
  const targetAt = e => {
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.gauge');
    return target?.parentElement === gauges ? target : null;
  };
  const finish = e => {
    if (!drag || (e.pointerId != null && e.pointerId !== drag.id)) return;
    const current = drag;
    drag = null;
    current.gauge.classList.remove('gauge-moving');
    gauges.querySelector('.gauge-drop-target')?.classList.remove('gauge-drop-target');
    if (e.type === 'pointerup' && current.moved) {
      const target = targetAt(e);
      if (target) move(current.gauge, target);
    }
    if (gauges.hasPointerCapture(current.id)) gauges.releasePointerCapture(current.id);
  };
  gauges.addEventListener('pointerdown', e => {
    const heading = e.target.closest('h3'), gauge = heading?.closest('.gauge');
    if (e.button !== 0 || !e.isPrimary || drag || gauge?.parentElement !== gauges) return;
    e.preventDefault();
    gauge.focus({ preventScroll: true });
    drag = { gauge, id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    gauges.setPointerCapture(e.pointerId);
  });
  gauges.addEventListener('pointermove', e => {
    if (!drag || drag.id !== e.pointerId) return;
    drag.moved ||= Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 5;
    if (!drag.moved) return;
    drag.gauge.classList.add('gauge-moving');
    gauges.querySelector('.gauge-drop-target')?.classList.remove('gauge-drop-target');
    const target = targetAt(e);
    if (target && target !== drag.gauge) target.classList.add('gauge-drop-target');
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) gauges.addEventListener(type, finish);
  // The title is the drag surface; the rest of each gauge still opens measurement details.
  gauges.addEventListener('click', e => { if (e.target.closest('h3')) e.stopPropagation(); });
  gauges.addEventListener('keydown', e => {
    if (e.key === 'Escape' && drag) { finish(e); e.stopPropagation(); return; }
    if (!e.altKey || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const gauge = e.target.closest('.gauge');
    if (gauge?.parentElement !== gauges) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.key === 'ArrowLeft' ? gauge.previousElementSibling : gauge.nextElementSibling;
    if (target) move(gauge, target);
  });
}

if (location.search.includes('selftest')) {
  initLayout();
  console.assert([...document.querySelectorAll('#gauges > .gauge')].map((g) => g.dataset.panel).join() === order.join(),
    'gauge layout: all eight gauges follow the saved order');
  console.assert(!document.querySelector('#gauges .grip, #gauges .rz'), 'gauge layout: freeform panel and resize controls stay disabled');
}
