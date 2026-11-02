import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../site/js/forecast-hazards.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const apiSource = readFileSync(new URL('../site/js/api.js', import.meta.url), 'utf8');
const point = apiSource.slice(apiSource.indexOf('export function pointInRing'), apiSource.indexOf('/// The strongest category')).replace('export ', '');
const geometry = vm.createContext({}); vm.runInContext(point, geometry);
const c = vm.createContext({Date, URLSearchParams, api:{pointInRing:geometry.pointInRing}});
vm.runInContext(source, c);
const now = Date.parse('2026-11-01T15:00:00Z');
const square = [[-100,30],[-90,30],[-90,40],[-100,40],[-100,30]];
const hole = [[-98,32],[-94,32],[-94,36],[-98,36],[-98,32]];
const polygon = {type:'Polygon',coordinates:[square]};
const spc = label => ({LABEL:label, DN:90, VALID:'202611011200',EXPIRE:'202611021200',ISSUE:'202611011100'});
const rain = dn => ({dn,start_time:'2026-11-01 12:00:00',end_time:'2026-11-02 12:00:00',issue_time:'2026-11-01 11:00:00'});
const feature = (properties, g = polygon) => ({type:'Feature',properties,geometry:g});
const collection = features => ({type:'FeatureCollection',features});
const at = (features, kind = 'torn', lat = 31, lon = -99, metadata = null) => c.polygonOutlook(collection(features),kind,lat,lon,now,metadata);

assert.equal(c.hazardTime('202611011200'),Date.parse('2026-11-01T12:00:00Z'));
assert.equal(c.hazardTime('2026-11-01 12:00:00'),Date.parse('2026-11-01T12:00:00Z'),'WPC times are UTC even on a local-time client');
assert.ok(Number.isNaN(c.hazardTime(null)));
assert.equal(c.hazardContains(polygon,31,-99),true);
assert.equal(c.hazardContains({type:'Polygon',coordinates:[square,hole]},33,-96),false,'Interior holes exclude the location');
assert.equal(c.hazardContains({type:'MultiPolygon',coordinates:[[hole],[square]]},31,-99),true);
assert.equal(c.hazardContains(polygon,20,-99),false);
assert.equal(c.hazardContains({type:'Polygon',coordinates:[]},31,-99),null,'Malformed geometry is not a clear outlook');
assert.equal(at([feature(spc('0.15')),feature(spc('0.02')),feature(spc('CIG2'))]).risk,15,'Select highest probability independent of feature order');
assert.equal(at([feature(spc('0.15')),feature(spc('CIG2'))]).cig,2,'Conditional intensity is separate from probability');
assert.equal(at([feature(spc('0.02'))]).risk,2,'Use probability LABEL, not CIG-related DN');
assert.equal(at([feature(spc('unexpected'))]).status,'unavailable');
assert.equal(at([feature(spc(''))]).status,'unavailable','An empty label is not zero percent');
assert.equal(at([feature(spc('0.05'),{type:'Polygon',coordinates:[square,hole]})],'torn',33,-96).risk,0);
assert.equal(at([feature(rain(1)),feature(rain(4)),feature(rain(2))],'rain').risk,4);
assert.equal(at([feature(rain(1))],'rain',20,-99).risk,0);
assert.equal(at([feature(rain(0))],'rain').status,'available','Explicit zero category is a known below-contour outlook');
assert.equal(at([feature({...rain(2),dn:null})],'rain').status,'unavailable');
assert.equal(at([feature({...spc('0.02'),EXPIRE:'202611011400'})]).status,'expired');
assert.equal(at([feature({...spc('0.02'),ISSUE:'202610281100'})]).status,'unavailable','Old publication dates cannot masquerade as current');
assert.equal(at([feature({...spc('0.02'),ISSUE:'202611051100'})]).status,'unavailable','Reject future issue times');
assert.equal(at([], 'torn').status,'unavailable','No geometry and no validity metadata is unknown');
assert.equal(at([], 'torn',31,-99,collection([feature(spc('TSTM'))])).risk,0,'Current categorical metadata verifies an empty probability layer');
assert.equal(c.polygonOutlook({error:{code:503}},'rain',31,-99,now).status,'unavailable');

const sample = (value, start = now - 3 * 3600000, issued = now - 3600000) => ({value,attributes:{idp_validtime:start,idp_filedate:issued}});
assert.equal(c.heatOutlook({samples:[sample('0.000000000')]},now)[0].risk,0,'Actual zero remains a valid HeatRisk value');
assert.equal(c.heatOutlook({samples:[sample(null),sample(''),sample('NoData'),sample('5'),sample('-1'),sample('1.5')]},now).length,0,'Missing and unrecognized samples never become no risk');
assert.equal(c.heatOutlook({samples:[sample('1'),sample('3',now - 3 * 3600000,now - 1800000)]},now)[0].risk,3,'Latest raster for a day wins');
assert.equal(c.heatOutlook({samples:[sample('2',now - 2 * 86400000)]},now).length,0,'Expired heat days are removed');
assert.equal(c.heatOutlook({error:{code:503}},now).length,0);

const fc = {forecast:{daily:[{sunset:18*3600},{sunrise:30*3600}],hourly:Array.from({length:12},(_,i)=>({time:(18+i)*3600,air_temperature:80-i}))}};
assert.equal(c.overnightCooling(fc,16*3600).low,69);
assert.equal(c.overnightCooling(fc,16*3600).high,80);
assert.equal(c.overnightCooling(fc,20*3600).partial,true);
assert.equal(c.overnightCooling(fc,31*3600),null);
const gap = structuredClone(fc); gap.forecast.hourly.splice(5,1);
assert.equal(c.overnightCooling(gap,16*3600),null,'Do not call incomplete hourly coverage an overnight minimum');
const missing = structuredClone(fc); missing.forecast.hourly[4].air_temperature = null;
assert.equal(c.overnightCooling(missing,16*3600),null);
assert.equal(c.overnightCooling({forecast:{daily:[],hourly:[]}},16*3600),null);

assert.match(source,/everyVisible\('forecast-hazards', 1800/);
assert.doesNotMatch(source,/setInterval|setTimeout|innerHTML/,'Hazards reuse the scheduler and safe DOM text');
assert.match(source,/ticket === generation && key === contextKey\(\)/,'Late location results are discarded');
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this._text = ''; }
  set textContent(value) { this._text = value; this.children = []; }
  get textContent() { return this._text + this.children.map(e => e.textContent).join(' '); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; this._text = ''; }
}
const listeners = {}, scheduled = [];
let location = {lat:31,lon:-99}, resolveOld, requests = 0;
class Clock extends Date { static now() { return now; } }
const ui = vm.createContext({Date:Clock,URLSearchParams,
  document:{createElement:tag=>new Element(tag)},
  window:{addEventListener:(type,fn)=>listeners[type]=fn},
  coords:()=>location,cacheContext:()=>JSON.stringify(location),forecast:()=>null,
  everyVisible:(name,seconds,host,fn)=>scheduled.push(fn),num:Math.round,U:{temp:()=> '°F'},
  api:{
    pointInRing:geometry.pointInRing,
    nwsPoint:lat=>lat===31 ? new Promise(resolve=>{resolveOld=resolve;}) : Promise.resolve({properties:{cwa:'TEST'}}),
    spcOutlook:async()=>collection([feature(spc('TSTM'))]),
    getJSON:async url=>{
      requests++;
      if(url.includes('/getSamples')) return {samples:[sample('0')]};
      if(url.includes('/query')) return collection([feature(rain(3))]);
      return collection([feature(spc('0.05'))]);
    },
  },
});
vm.runInContext(source,ui);
const host = new Element('div');
ui.initForecastHazards(host); ui.initForecastHazards(host);
assert.equal(scheduled.length,1,'Initialize one visible-only scheduler even if called twice');
const oldRequest = scheduled[0]();
location = {lat:45,lon:-80}; listeners['wd:settings']();
await scheduled[1]();
assert.equal(requests,10,'One refresh loads three WPC layers, one HeatRisk point and six probabilities');
assert.match(host.textContent,/Below mapped contours/);
const currentText = host.textContent;
resolveOld({properties:{cwa:'OLD'}});
await oldRequest;
assert.equal(host.textContent,currentText,'An old location cannot overwrite the new location');
assert.equal(requests,10,'Obsolete coverage requests do not launch hazard fetches');
location = {lat:51.5,lon:0}; listeners['wd:settings']();
await scheduled[2]();
assert.match(host.textContent,/contiguous United States/);
assert.doesNotMatch(host.textContent,/Below mapped contours/,'Unsupported coverage never looks like a clear outlook');
console.log('Forecast hazards: polygons, validity, CIG, HeatRisk, overnight coverage and location-safe scheduling passed');
