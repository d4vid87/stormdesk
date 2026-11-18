import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('../site/js/desk-layout.js', import.meta.url),'utf8');
const {DESK_PANELS, DESK_GROUPS, defaultDeskLayout, normalizeDeskLayout, reorderDeskItem, moveDeskPanel, placeDeskItem, applyDeskLayout} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const defaults = defaultDeskLayout();
const restored = normalizeDeskLayout({nav:'javascript:alert(1)', icons:'sideways', gauges:['g-wind','g-wind','removed-gauge'], navigation:['settings','weather'], zones:{top:['sky','sky','removed-panel'],main:['sky','forecast'],side:[],bottom:['winter']}});
assert.equal(restored.nav,'top');
assert.equal(restored.icons,'left');
assert.deepEqual(restored.navigation,['settings','weather','radar','history']);
assert.equal(restored.gauges[0],'g-wind');
assert.equal(restored.gauges.length,Object.keys(DESK_GROUPS.gauges).length);
assert.deepEqual(Object.values(restored.zones).flat().sort(),Object.keys(DESK_PANELS).sort(),'all data panels occur exactly once after restoring old or malformed preferences');
assert.deepEqual(restored.zones.top,['sky','gauges']);
assert.deepEqual(normalizeDeskLayout(null),defaults);
assert.deepEqual(normalizeDeskLayout([]),defaults);
assert.deepEqual(normalizeDeskLayout({}),defaults);
assert.deepEqual(normalizeDeskLayout(restored),restored,'normalization is idempotent');
restored.gauges.pop();
assert.equal(defaultDeskLayout().gauges.length,8,'each default layout owns its arrays');

const custom = normalizeDeskLayout({nav:'right',icons:'above'});
assert.equal(custom.nav,'right');
assert.equal(custom.icons,'above');
assert.equal(reorderDeskItem(custom,'navigation','weather',-1),false);
assert.equal(reorderDeskItem(custom,'navigation','weather',1),true);
assert.deepEqual(custom.navigation,['radar','weather','history','settings']);
assert.equal(reorderDeskItem(custom,'header','clock',.5),false);
assert.equal(reorderDeskItem(custom,'unknown','clock',1),false);
assert.equal(moveDeskPanel(custom,'hourly','side'),true);
assert.deepEqual(custom.zones.main,[]);
assert.deepEqual(custom.zones.side,['precip','sky','hourly']);
assert.equal(reorderDeskItem(custom,'panels','hourly',-1),true);
assert.deepEqual(custom.zones.side,['precip','hourly','sky']);
assert.equal(placeDeskItem(custom,'panels','forecast','sky',true),true);
assert.deepEqual(custom.zones.top,['gauges']);
assert.deepEqual(custom.zones.side,['precip','hourly','sky','forecast']);
assert.equal(placeDeskItem(custom,'gauges','g-dew','g-rain'),true);
assert.deepEqual(custom.gauges.slice(0,2),['g-dew','g-rain']);
const unchanged = structuredClone(custom);
assert.equal(moveDeskPanel(custom,'missing','side'),false);
assert.equal(moveDeskPanel(custom,'forecast','missing'),false);
assert.equal(placeDeskItem(custom,'panels','forecast','missing'),false);
assert.equal(placeDeskItem(custom,'gauges','g-rain','g-rain'),false);
assert.deepEqual(custom,unchanged,'invalid moves cannot corrupt a saved arrangement');
assert.deepEqual(Object.values(custom.zones).flat().sort(),Object.keys(DESK_PANELS).sort());
assert.deepEqual(defaults,defaultDeskLayout(),'editing a custom arrangement preserves reset defaults');
reorderDeskItem(custom,'header','temp',-1);

// A small DOM fixture proves ownership and restoration without adding a DOM dependency.
let moves = 0;
class Element {
  constructor(tag='div',id='',className='') { this.tag=tag; this.id=id; this.className=className; this.nodeType=1; this.childNodes=[]; this.dataset={}; this.style={getPropertyValue:()=>'',setProperty:()=>{}}; }
  get children() { return this.childNodes.filter(n=>n.nodeType===1); }
  get previousSibling() { return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this)-1] || null; }
  get classList() { return {contains:c=>this.className.split(' ').includes(c),toggle:(c,on)=>{ const set=new Set(this.className.split(' ').filter(Boolean)); if(on)set.add(c);else set.delete(c);this.className=[...set].join(' '); }}; }
  insert(node,index) { if(node.parentNode) { const previous=node.parentNode,at=previous.childNodes.indexOf(node);previous.childNodes.splice(at,1);if(previous===this && at<index)index--; } this.childNodes.splice(index,0,node);node.parentNode=this;moves++; }
  append(...nodes) { for(const node of nodes)this.insert(node,this.childNodes.length); }
  before(node) { this.parentNode.insert(node,this.parentNode.childNodes.indexOf(this)); }
  after(node) { this.parentNode.insert(node,this.parentNode.childNodes.indexOf(this)+1); }
  all() { return this.children.flatMap(child=>[child,...child.all()]); }
  querySelector(selector) { return this.all().find(node=>selector==='nav' ? node.tag==='nav' : selector.startsWith('.') ? node.classList.contains(selector.slice(1)) : selector.startsWith('[data-panel=') ? node.dataset.panel===selector.match(/"([^"]+)"/)[1] : selector.startsWith('[data-section=') ? node.dataset.section===selector.match(/"([^"]+)"/)[1] : false) || null; }
  getBoundingClientRect() { return {bottom:64}; }
}
const add = (parent,tag,id,classes='') => { const node=new Element(tag,id,classes);parent.append(node);return node; };
const body=new Element('body'), header=add(body,'header'), nav=add(header,'nav');
for(const id of ['desk','lab','data']) add(nav,'button').dataset.section=id;
const settingsButton=add(header,'button','btn-settings'); settingsButton.onclick=()=>42;
const main=add(body,'main'), desk=add(main,'section','desk','outlook-view balanced-desk');
const heading=add(desk,'div','observatory-heading'), conditions=add(heading,'div','','forecast-conditions');
add(conditions,'div','','observatory-place');
const hero=add(conditions,'div','hero'), heroNow=add(hero,'div','','hero-now');
const temperature=add(heroNow,'div','','hero-temperature'); add(temperature,'strong','hero-temp');
add(heroNow,'div','','hero-conditions'); add(heading,'div','','observatory-clock'); add(heading,'div','','weather-view');
const alerts=add(heading,'div','hero-alerts');
const grid=add(desk,'div','observatory-grid'), radar=add(grid,'section','observatory-radar'), shelf=add(radar,'div','radar-shelf');
const gauges=add(shelf,'div','gauges');
for(const id of defaults.gauges) { const outer=add(gauges,'div');outer.dataset.panel=id;add(outer,'div',id); }
const iframe=add(radar,'iframe','desk-radar-frame'); iframe.src='https://hookecho.io/';
const forecast=add(grid,'section','observatory-forecast');forecast.onclick=()=>17;
add(grid,'section','forecast-hourly');
const sidebar=add(grid,'aside','forecast-sidebar'); add(sidebar,'section','forecast-precip');add(sidebar,'section','outlook-astronomy');
const cards=add(grid,'div','balanced-contexts');for(const id of ['hazards','air','changes','winter']) add(cards,'section',`balanced-${id}`);
const observers=[];
globalThis.document={body,getElementById:id=>body.all().find(n=>n.id===id)||null,querySelector:s=>s==='body > header'?header:null,createElement:tag=>new Element(tag),createComment:()=>Object.assign(new Element(),{nodeType:8})};
globalThis.ResizeObserver=class { observe() {} };
globalThis.MutationObserver=class { constructor(callback){this.callback=callback;}observe(){observers.push(this.callback);} };
const originalIds=body.all().filter(node=>node.id).map(node=>node.id).sort();
assert.equal(applyDeskLayout(custom),true);
assert.equal(nav.parentNode.id,'desk-navigation-dock');
assert.equal(settingsButton.parentNode,nav);
assert.equal(settingsButton.onclick(),42,'moving settings preserves its existing handler');
assert.equal(temperature.parentNode,heading);
assert.equal(forecast.parentNode.dataset.deskZone,'side');
assert.equal(forecast.onclick(),17,'moved cards retain existing handlers');
assert.equal(gauges.children[0].dataset.panel,'g-dew');
assert.equal(iframe.parentNode,radar);
assert.equal(iframe.src,'https://hookecho.io/','customization never reloads radar');
const afterFirst=moves;
applyDeskLayout(custom);
assert.equal(moves,afterFirst,'applying unchanged preferences does not move live DOM again');
desk.classList.toggle('outlook-view',false);for(const notify of observers)notify();
assert.equal(gauges.parentNode,shelf,'radar restores its integrated gauge shelf');
assert.equal(temperature.parentNode,heroNow,'radar restores the original hero structure');
assert.equal(forecast.parentNode,grid);
assert.equal(iframe.parentNode,radar);
assert.equal(iframe.src,'https://hookecho.io/');
desk.classList.toggle('outlook-view',true);for(const notify of observers)notify();
assert.equal(forecast.parentNode.dataset.deskZone,'side','forecast restores the saved custom position');
assert.equal(temperature.parentNode,heading);
assert.equal(heading.children.at(-1),alerts,'weather alerts are never hidden or removed by header ordering');
const finalIds=body.all().filter(node=>node.id).map(node=>node.id);
assert.equal(new Set(finalIds).size,finalIds.length,'no duplicate renderer IDs');
assert.deepEqual(finalIds.filter(id=>id!=='desk-navigation-dock').sort(),originalIds,'all original render targets survive the round trip');
applyDeskLayout(defaultDeskLayout());
assert.equal(nav.parentNode,header,'reset returns navigation to the original header');
assert.equal(forecast.parentNode,grid,'default panels retain the original Balanced Desk viewport-fit containers');
assert.equal(gauges.parentNode,shelf);
assert.equal(desk.classList.contains('desk-panels-custom'),false);
assert.equal(temperature.parentNode,heroNow,'default header restores the compact original hero structure');
console.log('desk layout: saved-state repair, movement, DOM identity, handlers, idempotence and radar round trip passed');
