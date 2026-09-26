(() => {
const palettes = [{"id": "cobalt", "name": "Cobalt", "mode": "light", "description": "Cool paper. Electric blue. Precise and technical.", "colors": {"bg": "#eef2f8", "panel": "#ffffff", "secondary": "#dde5f0", "text": "#10213b", "muted": "#4d5f78", "line": "#b7c5d8", "accent": "#164bc0", "action": "#245eea", "actionInk": "#ffffff", "radar": "#101e35"}}, {"id": "alpine", "name": "Alpine", "mode": "light", "description": "Soft ivory and forest green. Calm, grounded, outdoors.", "colors": {"bg": "#eff1e7", "panel": "#fafcf3", "secondary": "#dfe5d5", "text": "#19291d", "muted": "#52634c", "line": "#b5c1aa", "accent": "#24603c", "action": "#286341", "actionInk": "#ffffff", "radar": "#17291e"}}, {"id": "copper", "name": "Copper", "mode": "light", "description": "Warm parchment with burnt copper. An editorial field manual.", "colors": {"bg": "#f4ece1", "panel": "#fff8ee", "secondary": "#e8dac7", "text": "#33251e", "muted": "#705b4e", "line": "#cbbbA5", "accent": "#9b3c1c", "action": "#ac4320", "actionInk": "#ffffff", "radar": "#30211b"}}, {"id": "lagoon", "name": "Lagoon", "mode": "light", "description": "Pale mineral green with deep teal. Clear and refreshing.", "colors": {"bg": "#e8f2ef", "panel": "#f7fffc", "secondary": "#d2e6e0", "text": "#14332e", "muted": "#47685f", "line": "#a8c6bd", "accent": "#006a61", "action": "#006d63", "actionInk": "#ffffff", "radar": "#12352f"}}, {"id": "orchid", "name": "Orchid", "mode": "light", "description": "Lavender paper and rich violet. A softer technical character.", "colors": {"bg": "#f0edf7", "panel": "#fcfaff", "secondary": "#e2dced", "text": "#30223f", "muted": "#655570", "line": "#c0b5ce", "accent": "#6b32a5", "action": "#7239b2", "actionInk": "#ffffff", "radar": "#2a1d3a"}}, {"id": "midnight", "name": "Midnight", "mode": "dark", "description": "Deep navy with icy blue. A focused overnight workstation.", "colors": {"bg": "#0c1728", "panel": "#14243a", "secondary": "#1c3049", "text": "#edf4ff", "muted": "#a9bbd3", "line": "#3d5470", "accent": "#83c5ff", "action": "#83c5ff", "actionInk": "#0c2037", "radar": "#08111f"}}, {"id": "carbon", "name": "Carbon", "mode": "dark", "description": "Charcoal and amber. Instrument-panel contrast.", "colors": {"bg": "#1b1b1a", "panel": "#252523", "secondary": "#30302c", "text": "#f4f1e7", "muted": "#c0bcae", "line": "#57564d", "accent": "#ffc45d", "action": "#ffc45d", "actionInk": "#302007", "radar": "#121211"}}, {"id": "aurora", "name": "Aurora", "mode": "dark", "description": "Deep evergreen and acid lime. Sharp, energetic, field-ready.", "colors": {"bg": "#101e19", "panel": "#1b2c24", "secondary": "#25392e", "text": "#eef6e9", "muted": "#afc4b4", "line": "#496451", "accent": "#c0ed72", "action": "#c0ed72", "actionInk": "#192509", "radar": "#0a1510"}}, {"id": "merlot", "name": "Merlot", "mode": "dark", "description": "Black cherry and dusty rose. Atmospheric without the glow.", "colors": {"bg": "#24161e", "panel": "#32212b", "secondary": "#432d39", "text": "#fff0f6", "muted": "#d1b0c0", "line": "#715060", "accent": "#ffa5c5", "action": "#ffa5c5", "actionInk": "#391528", "radar": "#180e14"}}, {"id": "monochrome", "name": "Monochrome", "mode": "dark", "description": "Near-black and chalk white. Pure hierarchy, minimal color.", "colors": {"bg": "#151515", "panel": "#222222", "secondary": "#303030", "text": "#f6f6f2", "muted": "#bdbdb8", "line": "#555552", "accent": "#eeeeea", "action": "#eeeeea", "actionInk": "#181818", "radar": "#090909"}}];
const key = 'stormdesk:website-palette';
let saved;
try { saved = localStorage.getItem(key); } catch {}
const requested = new URL(location.href).searchParams.get('palette');
let selected = palettes.find(p => p.id === (requested ?? saved)) || palettes.find(p => p.id === 'carbon');
const apply = () => {
 document.documentElement.dataset.palette = selected.id;
 document.querySelector('meta[name="theme-color"]')?.setAttribute('content', selected.colors.bg);
};
const persist = () => { try { if(selected.id === 'carbon') localStorage.removeItem(key); else localStorage.setItem(key, selected.id); } catch {} };
apply();
if (requested !== null) persist();
document.addEventListener('DOMContentLoaded', () => {
 const picker = document.querySelector('#color-choice');
 const panel = document.querySelector('.color-picker');
 const reflect = () => {
  picker.value = selected.id;
  document.querySelector('[data-color-label]').textContent = `${String(palettes.indexOf(selected)+1).padStart(2,'0')} / ${selected.name}`;
  document.querySelector('[data-color-description]').textContent = selected.description;
 };
 const choose = id => {
  selected = palettes.find(p => p.id === id) || palettes.find(p => p.id === 'carbon');
  apply(); persist();
  const url = new URL(location.href);
  if(selected.id === 'carbon') url.searchParams.delete('palette'); else url.searchParams.set('palette',selected.id);
  history.replaceState(null,'',url);
  reflect();
 };
 picker.addEventListener('change', () => choose(picker.value));
 const step = delta => choose(palettes[(palettes.indexOf(selected)+delta+palettes.length)%palettes.length].id);
 document.querySelector('[data-color-prev]').addEventListener('click', () => step(-1));
 document.querySelector('[data-color-next]').addEventListener('click', () => step(1));
 document.querySelector('[data-color-reset]').addEventListener('click', () => choose('carbon'));
 document.addEventListener('keydown', e => { if(e.key === 'Escape' && panel.open) { panel.open=false; panel.querySelector('summary').focus(); } });
 reflect();
});
})();