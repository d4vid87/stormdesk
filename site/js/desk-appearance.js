import { settings, saveSettings, applyTheme } from './app.js';

export const DESK_STYLES = [
  { id: 'observatory', name: 'Observatory', description: 'Joined instruments, balanced panels and clear typography.', gaugeStyle: 'orbit' },
  { id: 'mission', name: 'Mission Control', description: 'Precise dials, squared menus and technical readings.', gaugeStyle: 'dial' },
  { id: 'skyline', name: 'Skyline Glass', description: 'Sculpted cards, rounded menus and polished instruments.', gaugeStyle: 'chrome' },
  { id: 'journal', name: 'Weather Journal', description: 'Editorial headings, fine rules and quiet instruments.', gaugeStyle: 'neon' },
  { id: 'night', name: 'Night Watch', description: 'Prominent readings, crisp outlines and luminous instruments.', gaugeStyle: 'neon' },
];

const deskStyle = id => DESK_STYLES.find(style => style.id === id);

// Settings remains the source of truth for the complete theme catalog.
export function availableThemes() {
  return [...(document.getElementById('set-palette')?.options || [])].map(option => ({
    id: option.value,
    name: option.textContent.trim(),
    group: option.parentElement?.label || '',
  }));
}

export function currentTheme() {
  const { palette, theme } = settings();
  if (theme === 'light' && ['solarized', 'contrast'].includes(palette)) return `${palette}-light`;
  return palette || (theme === 'light' ? 'light' : theme === 'auto' ? 'auto' : 'blue');
}

export function syncDeskAppearance() {
  const style = deskStyle(settings().deskStyle) || DESK_STYLES[0];
  document.documentElement.dataset.deskStyle = style.id;
  return style;
}

export function applyDeskStyle(id, { matchGauges = settings().deskMatchGauges !== false } = {}) {
  const style = deskStyle(id);
  if (!style) return false;
  const match = !!matchGauges;
  saveSettings({ deskStyle: id, deskMatchGauges: match, ...(match ? { gaugeStyle: style.gaugeStyle } : {}) });
  syncDeskAppearance();
  return true;
}

export function applyDeskMatchGauges(match) {
  return applyDeskStyle((deskStyle(settings().deskStyle) || DESK_STYLES[0]).id, { matchGauges: match });
}

export function applyDeskTheme(id) {
  if (!availableThemes().some(theme => theme.id === id)) return false;
  saveSettings({
    theme: ['light', 'solarized-light', 'contrast-light'].includes(id) ? 'light' : id === 'auto' ? 'auto' : 'dark',
    palette: ['blue', 'light', 'auto'].includes(id) ? '' : id.replace(/-light$/, ''),
    accent: '',
  });
  applyTheme();
  return true;
}

let initialized = false;
export function initDeskAppearance() {
  syncDeskAppearance();
  if (initialized) return;
  initialized = true;
  window.addEventListener('wd:settings', event => {
    const patch = event.detail || {};
    // A choice in the existing Gauge Style picker becomes a personal override.
    if (Object.hasOwn(patch, 'gaugeStyle') && !Object.hasOwn(patch, 'deskStyle') &&
        !Object.hasOwn(patch, 'deskMatchGauges') && settings().deskMatchGauges !== false) {
      saveSettings({ deskMatchGauges: false });
    }
    if (Object.hasOwn(patch, 'deskStyle')) syncDeskAppearance();
  });
}
