import { settings, saveSettings } from './app.js';
import { DESK_STYLES, availableThemes, currentTheme, applyDeskStyle, applyDeskTheme, applyDeskMatchGauges, initDeskAppearance } from './desk-appearance.js';
import { DESK_ZONES, DESK_PANELS, DESK_GROUPS, defaultDeskLayout, normalizeDeskLayout, reorderDeskItem, moveDeskPanel, placeDeskItem, applyDeskLayout } from './desk-layout.js';

const node = (tag, cls = '', text) => {
  const el = document.createElement(tag); el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};
const button = (label, cls = '') => { const el = node('button', cls, label); el.type = 'button'; return el; };
const select = (label, options) => {
  const el = node('select'); el.setAttribute('aria-label', label);
  for (const [value, text] of Object.entries(options)) { const option = node('option', '', text); option.value = value; el.append(option); }
  return el;
};

export function initDeskCustomize() {
  if (document.getElementById('desk-customize')) return;
  const controls = document.querySelector('.gauge-style-control');
  if (!controls) return;
  initDeskAppearance();
  const trigger = button('', 'desk-customize-trigger'); trigger.id = 'desk-customize';
  trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-controls', 'desk-customize-dialog');
  trigger.innerHTML = '<span class="customize-grid-glyph" aria-hidden="true">▦</span><span><small>CUSTOMIZE DESK</small><b></b></span><span aria-hidden="true">⌄</span>';
  controls.prepend(trigger);
  const dialog = node('dialog'); dialog.id = 'desk-customize-dialog'; dialog.setAttribute('aria-labelledby', 'desk-customize-title');
  const heading = node('div', 'customize-heading'), title = node('div');
  const h = node('h2', '', 'Customize your desk'); h.id = 'desk-customize-title';
  title.append(h, node('p', '', 'Your layout. Your colors. Your instruments.'));
  const close = button('×', 'customize-close'); close.setAttribute('aria-label', 'Close customization');
  close.onclick = () => dialog.close(); heading.append(title, close);
  const tabs = node('div', 'customize-tabs'); tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', 'Customization category');
  const pages = node('div', 'customize-pages'), pageNodes = {};
  for (const [id,label] of Object.entries({layout:'Layout',themes:'Themes',style:'Desk style'})) {
    const b = button(label); b.dataset.customizeTab = id; b.setAttribute('aria-pressed', String(id === 'layout'));
    const page = node('section'); page.id = `customize-${id}`; page.hidden = id !== 'layout'; page.setAttribute('aria-label', label);
    b.setAttribute('aria-controls', page.id); b.onclick = () => {
      for (const [name, p] of Object.entries(pageNodes)) p.hidden = name !== id;
      for (const tab of tabs.children) tab.setAttribute('aria-pressed', String(tab === b));
    };
    tabs.append(b); pages.append(page); pageNodes[id] = page;
  }
  const footer = node('div', 'customize-footer'), status = node('span', 'customize-status', 'Changes save on this device'); status.setAttribute('role', 'status');
  const done = button('Done', 'customize-done'); done.onclick = () => dialog.close(); footer.append(status, done);
  dialog.append(heading, tabs, pages, footer); document.body.append(dialog);
  const layout = () => normalizeDeskLayout(settings().deskLayout);
  const commitLayout = (value, message) => {
    saveSettings({deskLayout: value}); status.textContent = message;
  };
  const field = (label, control) => { const wrapper = node('label', 'customize-field'); wrapper.append(node('span', '', label), control); return wrapper; };
  const placement = node('div', 'customize-placement');
  const navigation = select('Navigation location', {top:'Top bar',left:'Left rail',right:'Right rail',bottom:'Bottom dock'});
  navigation.onchange = () => { const value = layout(); value.nav = navigation.value; commitLayout(value, 'Navigation moved'); };
  const icons = select('Icon position', {left:'Before labels',right:'After labels',above:'Above labels'});
  icons.onchange = () => { const value = layout(); value.icons = icons.value; commitLayout(value, 'Icon placement updated'); };
  placement.append(field('Navigation location', navigation), field('Icon position', icons));
  const group = select('Arrange', {panels:'Weather panels',gauges:'Individual gauges',navigation:'Navigation tabs',header:'Header & clock'});
  group.onchange = () => renderRows();
  const arrangeHeading = node('div', 'customize-arrange-heading');
  arrangeHeading.append(field('Arrange', group), node('p', '', 'Drag rows or use arrows. Changes appear immediately.'));
  const rows = node('div', 'customize-rows'), hint = node('p', 'customize-hint');
  const resetLayout = button('Restore default layout', 'customize-link'); resetLayout.onclick = () => commitLayout(defaultDeskLayout(), 'Default layout restored');
  pageNodes.layout.append(placement, arrangeHeading, rows, hint, resetLayout);

  function renderRows() {
    const value = layout(), kind = group.value;
    const list = kind === 'panels'
      ? Object.entries(value.zones).flatMap(([zone, ids]) => ids.map(id => ({id, label:DESK_PANELS[id], zone, ids})))
      : value[kind].map(id => ({id, label:DESK_GROUPS[kind][id], ids:value[kind]}));
    rows.replaceChildren();
    for (const item of list) {
      const row = node('div', 'customize-row'); row.draggable = true; row.dataset.item = item.id;
      const grip = node('span', 'customize-grip', '⠿'); grip.setAttribute('aria-hidden', 'true');
      row.append(grip, node('strong', '', item.label));
      if (item.zone) {
        const target = select(`Location for ${item.label}`, DESK_ZONES); target.value = item.zone;
        target.onchange = () => {
          const next = layout(); moveDeskPanel(next, item.id, target.value);
          commitLayout(next, `${item.label} moved to ${DESK_ZONES[target.value].toLowerCase()}`);
          rows.querySelector(`[data-item="${item.id}"] select`)?.focus({preventScroll:true});
        };
        row.append(target);
      }
      const arrows = node('span', 'customize-arrows');
      for (const delta of [-1, 1]) {
        const move = button(delta < 0 ? '↑' : '↓');
        move.dataset.move = String(delta); move.setAttribute('aria-label', `Move ${item.label} ${delta < 0 ? 'earlier' : 'later'}`);
        move.disabled = delta < 0 ? item.ids[0] === item.id : item.ids.at(-1) === item.id;
        move.onclick = () => {
          const next = layout(); reorderDeskItem(next, kind, item.id, delta); commitLayout(next, `${item.label} moved`);
          const updated = rows.querySelector(`[data-item="${item.id}"]`);
          const preferred = updated.querySelector(`[data-move="${delta}"]`);
          (preferred.disabled ? updated.querySelector('button:not(:disabled)') : preferred)?.focus({preventScroll:true});
        };
        arrows.append(move);
      }
      row.append(arrows); rows.append(row);
    }
    hint.textContent = kind === 'panels' ? 'Choose an area, then arrange panels within it. Smaller screens stack the columns.' : 'Order runs left to right, or top to bottom in a rail.';
  }
  let dragging = null;
  rows.addEventListener('dragstart', e => {
    const row = e.target.closest('[data-item]'); if (!row) return;
    dragging = row.dataset.item; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragging); row.classList.add('dragging');
  });
  const clearDrag = () => { dragging = null; rows.querySelectorAll('[data-drop],.dragging').forEach(row => { delete row.dataset.drop; row.classList.remove('dragging'); }); };
  rows.addEventListener('dragover', e => {
    const row = e.target.closest('[data-item]'); if (!dragging || !row) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    rows.querySelectorAll('[data-drop]').forEach(el => delete el.dataset.drop);
    const rect = row.getBoundingClientRect(); row.dataset.drop = e.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
  });
  rows.addEventListener('drop', e => {
    const row = e.target.closest('[data-item]'); if (!dragging || !row) return;
    e.preventDefault(); const rect = row.getBoundingClientRect(), next = layout();
    placeDeskItem(next, group.value, dragging, row.dataset.item, e.clientY > rect.top + rect.height / 2);
    clearDrag(); commitLayout(next, 'Order updated');
  });
  rows.addEventListener('dragend', clearDrag);

  const themeGrid = node('div', 'customize-theme-grid');
  for (const theme of availableThemes()) {
    const choice = button('', 'customize-theme'); choice.dataset.themeChoice = theme.id;
    const swatch = node('span', 'customize-theme-swatch'); swatch.dataset.theme = theme.id; swatch.setAttribute('aria-hidden', 'true');
    swatch.append(node('i'), node('i'), node('i'));
    choice.append(swatch, node('span', '', theme.name));
    choice.onclick = () => { applyDeskTheme(theme.id); status.textContent = `${theme.name} applied`; };
    themeGrid.append(choice);
  }
  pageNodes.themes.append(node('p', 'customize-hint', 'All StormDesk themes. Your layout and gauge style stay as you arranged them.'), themeGrid);
  const styleGrid = node('div', 'customize-style-grid');
  for (const style of DESK_STYLES) {
    const choice = button('', 'customize-style'); choice.dataset.deskStyleChoice = style.id;
    const preview = node('span', 'customize-style-preview'); preview.dataset.look = style.id; preview.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 5; i++) preview.append(node('i'));
    const label = node('span'); label.append(node('strong', '', style.name), node('small', '', style.description));
    choice.append(preview, label); choice.onclick = () => { applyDeskStyle(style.id); status.textContent = `${style.name} applied`; };
    styleGrid.append(choice);
  }
  const matching = node('input'); matching.type = 'checkbox'; matching.onchange = () => applyDeskMatchGauges(matching.checked);
  const matchLabel = node('label', 'customize-match'); matchLabel.append(matching, node('span', '', 'Match gauges to desk style'));
  pageNodes.style.append(styleGrid, matchLabel, node('p', 'customize-hint', 'Colors follow your chosen theme. Motion follows your existing appearance settings.'));

  function sync() {
    const s = settings(), value = layout();
    const style = DESK_STYLES.find(item => item.id === s.deskStyle) || DESK_STYLES[0];
    trigger.querySelector('b').textContent = style.name;
    trigger.setAttribute('aria-label', `Customize desk: ${style.name}. Layout, themes and styles`);
    navigation.value = value.nav; icons.value = value.icons; matching.checked = s.deskMatchGauges !== false;
    themeGrid.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themeChoice === currentTheme())));
    styleGrid.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.deskStyleChoice === style.id)));
  }
  trigger.onclick = () => {
    for (const open of document.querySelectorAll('dialog[open]')) if (open !== dialog) open.close();
    sync(); renderRows(); status.textContent = 'Changes save on this device'; dialog.showModal(); close.focus();
  };
  dialog.addEventListener('close', () => { clearDrag(); trigger.focus({preventScroll:true}); });
  window.addEventListener('wd:settings', e => {
    if (!['deskStyle','deskMatchGauges','deskLayout','theme','palette','gaugeStyle'].some(key => Object.hasOwn(e.detail || {}, key))) return;
    sync(); if (Object.hasOwn(e.detail, 'deskLayout')) { applyDeskLayout(settings().deskLayout); if (dialog.open) renderRows(); }
  });
  sync();
}
