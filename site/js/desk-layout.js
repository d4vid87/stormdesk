// Move live render targets, never the radar document or copies of weather cards.
export const DESK_ZONES = Object.freeze({top:'Top row', main:'Main column', side:'Sidebar', bottom:'Bottom row'});
export const DESK_PANELS = Object.freeze({gauges:'Current readings', forecast:'10-day forecast', hourly:'Hourly outlook', precip:'Precipitation outlook', sky:'Sun, moon & twilight', hazards:'Hazards & atmosphere', air:'Air & ground', changes:'Weather changes', winter:'Winter impact'});
export const DESK_GROUPS = Object.freeze({
  navigation:{weather:'Weather', radar:'Radar', history:'History', settings:'Settings'},
  header:{place:'Location & date', temp:'Temperature', conditions:'Current conditions', clock:'Clock', view:'Radar / forecast switch'},
  gauges:{'g-rain':'Rain today', 'g-ltg':'Lightning', 'g-wind':'Wind', 'g-wbgt':'WBGT', 'g-uv':'UV index', 'g-press':'Pressure', 'g-hum':'Humidity', 'g-dew':'Dew point'},
});
export function defaultDeskLayout() {
  return {nav:'top', icons:'left', navigation:Object.keys(DESK_GROUPS.navigation), header:Object.keys(DESK_GROUPS.header), gauges:Object.keys(DESK_GROUPS.gauges), zones:{top:['gauges','forecast'], main:['hourly'], side:['precip','sky'], bottom:['hazards','air','changes','winter']}};
}
function completeOrder(saved, defaults) {
  const allowed = Array.isArray(saved) ? saved.filter(id => typeof id === 'string' && defaults.includes(id)) : [];
  return [...new Set([...allowed, ...defaults])];
}
export function normalizeDeskLayout(saved) {
  const layout = defaultDeskLayout();
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return layout;
  if (['top','left','right','bottom'].includes(saved.nav)) layout.nav = saved.nav;
  if (['left','right','above'].includes(saved.icons)) layout.icons = saved.icons;
  for (const group of Object.keys(DESK_GROUPS)) layout[group] = completeOrder(saved[group], layout[group]);
  const seen = new Set(), zones = {};
  for (const zone of Object.keys(DESK_ZONES)) {
    zones[zone] = (Array.isArray(saved.zones?.[zone]) ? saved.zones[zone] : []).filter(id => {
      if (typeof id !== 'string' || !Object.hasOwn(DESK_PANELS,id) || seen.has(id)) return false;
      seen.add(id); return true;
    });
  }
  for (const [zone, ids] of Object.entries(layout.zones)) for (const id of ids) if (!seen.has(id)) zones[zone].push(id);
  layout.zones = zones;
  return layout;
}
function itemList(layout, group, id) {
  if (group === 'panels') return Object.values(layout.zones).find(ids => ids.includes(id));
  return Object.hasOwn(DESK_GROUPS,group) ? layout[group] : null;
}
export function reorderDeskItem(layout, group, id, offset) {
  const items = itemList(layout,group,id), index = items?.indexOf(id) ?? -1;
  if (!Number.isInteger(offset) || index < 0 || index + offset < 0 || index + offset >= items.length) return false;
  items.splice(index + offset, 0, items.splice(index,1)[0]); return true;
}
export function moveDeskPanel(layout, id, zone) {
  if (!Object.hasOwn(DESK_PANELS,id) || !Object.hasOwn(DESK_ZONES,zone)) return false;
  for (const ids of Object.values(layout.zones)) { const index = ids.indexOf(id); if (index >= 0) ids.splice(index,1); }
  layout.zones[zone].push(id); return true;
}
export function placeDeskItem(layout, group, id, target, after = false) {
  if (id === target) return false;
  let items = itemList(layout,group,target);
  if (!items || !itemList(layout,group,id)) return false;
  if (group === 'panels') {
    const zone = Object.keys(layout.zones).find(key => layout.zones[key] === items);
    moveDeskPanel(layout,id,zone); items = layout.zones[zone];
  }
  const index = items.indexOf(id);
  if (index < 0 || !items.includes(target)) return false;
  items.splice(index,1); items.splice(items.indexOf(target) + (after ? 1 : 0),0,id); return true;
}

let current = defaultDeskLayout(), context;
function orderNodes(parent, nodes) {
  const children = [...parent.children];
  if (children.length === nodes.length && nodes.every((node,index) => children[index] === node)) return;
  for (const node of nodes) parent.append(node);
}
function remember(node) {
  const marker = document.createComment('desk-layout position'); node.before(marker);
  return {node, marker};
}
function restorePositions(items) {
  for (const {node,marker} of items) if (marker.parentNode && node.previousSibling !== marker) marker.after(node);
}
function makeContext() {
  const desk = document.getElementById('desk'), grid = document.getElementById('observatory-grid');
  const header = document.querySelector('body > header'), navigation = header?.querySelector('nav');
  const head = document.getElementById('observatory-heading');
  if (!desk || !grid || !head || !navigation || !document.getElementById('balanced-winter')) return null;
  const byId = id => document.getElementById(id);
  const blocks = {gauges:byId('gauges'), forecast:byId('observatory-forecast'), hourly:byId('forecast-hourly'), precip:byId('forecast-precip'), sky:byId('outlook-astronomy'), hazards:byId('balanced-hazards'), air:byId('balanced-air'), changes:byId('balanced-changes'), winter:byId('balanced-winter')};
  const parts = {place:head.querySelector('.observatory-place'), temp:head.querySelector('.hero-temperature'), conditions:head.querySelector('.hero-conditions'), clock:head.querySelector('.observatory-clock'), view:head.querySelector('.weather-view')};
  const tabs = {weather:navigation.querySelector('[data-section="desk"]'), radar:navigation.querySelector('[data-section="lab"]'), history:navigation.querySelector('[data-section="data"]'), settings:byId('btn-settings')};
  if ([...Object.values(blocks),...Object.values(parts),...Object.values(tabs)].some(node => !node)) return null;
  const gauges = Object.fromEntries(Object.keys(DESK_GROUPS.gauges).map(id => [id,blocks.gauges.querySelector(`[data-panel="${id}"]`)]));
  if (Object.values(gauges).some(node => !node)) return null;
  const blockPositions = Object.values(blocks).map(remember);
  const headerPositions = Object.values(parts).map(remember);
  const positions = [...blockPositions,...headerPositions];
  const navPosition = remember(navigation);
  const dock = document.createElement('div'); dock.id = 'desk-navigation-dock'; dock.hidden = true; header.after(dock);
  const zones = Object.fromEntries(Object.keys(DESK_ZONES).map(id => {
    const zone = document.createElement('div'); zone.className = `desk-zone desk-zone-${id}`;
    zone.dataset.deskZone = id; zone.hidden = true; grid.append(zone); return [id,zone];
  }));
  for (const [id,node] of Object.entries(blocks)) node.dataset.deskBlock = id;
  for (const [id,node] of Object.entries(parts)) node.dataset.deskHeader = id;
  const next = {desk, grid, header, head, navigation, tabs, parts, blocks, gauges, blockPositions, headerPositions, positions, navPosition, dock, zones, forecastActive:null};
  const measureHeader = () => {
    const value = `${Math.ceil(header.getBoundingClientRect().bottom)}px`;
    if (document.body.style.getPropertyValue('--desk-nav-top') !== value) document.body.style.setProperty('--desk-nav-top',value);
  };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(measureHeader).observe(header);
  else window.addEventListener('resize',measureHeader,{passive:true});
  new MutationObserver(() => {
    if (next.forecastActive !== desk.classList.contains('outlook-view')) applyForecast(next);
  }).observe(desk,{attributes:true,attributeFilter:['class']});
  measureHeader();
  return next;
}
function applyForecast(ctx) {
  const active = ctx.desk.classList.contains('outlook-view');
  ctx.forecastActive = active;
  ctx.desk.classList.toggle('desk-layout-active',active);
  const standard = defaultDeskLayout().zones;
  const customPanels = active && Object.keys(DESK_ZONES).some(zone => current.zones[zone].join() !== standard[zone].join());
  const customHeader = active && current.header.join() !== defaultDeskLayout().header.join();
  ctx.desk.classList.toggle('desk-panels-custom',customPanels);
  ctx.desk.classList.toggle('desk-header-custom',customHeader);
  if (!active) {
    restorePositions(ctx.positions);
    for (const node of Object.values(ctx.zones)) node.hidden = true;
    return;
  }
  if (customPanels) {
    for (const [zone,ids] of Object.entries(current.zones)) {
      orderNodes(ctx.zones[zone],ids.map(id => ctx.blocks[id]));
      ctx.zones[zone].hidden = !ids.length;
    }
  } else {
    // Preserve Balanced Desk's existing viewport-fit row sizing for the default arrangement.
    restorePositions(ctx.blockPositions);
    for (const node of Object.values(ctx.zones)) node.hidden = true;
  }
  ctx.grid.dataset.deskColumns = current.zones.main.length && current.zones.side.length ? 'both' : 'single';
  if (customHeader) {
    // Alerts stay visible and last in the header, outside personal ordering.
    orderNodes(ctx.head,[...current.header.map(id => ctx.parts[id]),...([...ctx.head.children].filter(node => !Object.values(ctx.parts).includes(node)))]);
  } else restorePositions(ctx.headerPositions);
}
export function applyDeskLayout(saved) {
  current = normalizeDeskLayout(saved);
  context ||= makeContext();
  if (!context) return false;
  const ctx = context;
  document.body.dataset.deskNav = current.nav;
  document.body.dataset.deskIcons = current.icons;
  const navParent = current.nav === 'top' ? ctx.navPosition.marker.parentNode : ctx.dock;
  if (ctx.navigation.parentNode !== navParent) {
    if (current.nav === 'top') ctx.navPosition.marker.after(ctx.navigation);
    else navParent.append(ctx.navigation);
  }
  ctx.dock.hidden = current.nav === 'top';
  orderNodes(ctx.navigation,current.navigation.map(id => ctx.tabs[id]));
  orderNodes(ctx.blocks.gauges,current.gauges.map(id => ctx.gauges[id]));
  applyForecast(ctx);
  return true;
}
