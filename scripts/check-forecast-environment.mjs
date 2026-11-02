import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const apiSource = readFileSync(new URL('../site/js/api.js', import.meta.url), 'utf8');
const source = readFileSync(new URL('../site/js/forecast-environment.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const provider = vm.createContext({ Date, URL, settings: () => ({units:'imperial'}), msToWind: n => n,
  omIcon: () => 'cloudy', omWords: () => 'Cloudy', location:{href:'https://app.mystormdesk.com/'} });
vm.runInContext(apiSource.slice(apiSource.indexOf('export function shapeMetarObs'), apiSource.indexOf('// obs_st tuple')).replace(/^export /gm, ''), provider);
vm.runInContext(apiSource.slice(apiSource.indexOf('export function cacheSeconds'), apiSource.indexOf('async function fetchJSON')).replace('export ', ''), provider);
const now = Date.now() / 1000;
const record = p => ({properties:{timestamp:new Date(now * 1000).toISOString(), ...p},geometry:{coordinates:[-97.3,32.8]}});
const reading = p => provider.shapeMetarObs(record(p), false, now).obs[0];
const q = (value, unitCode = 'wmoUnit:m') => ({value,unitCode});
const measured = reading({cloudLayers:[{amount:'SCT',base:q(100)}, {amount:'OVC',base:q(900)}, {amount:'BKN',base:q(500)}],visibility:q(10,'wmoUnit:mi')});
assert.equal(measured.ceiling,500,'Lowest broken/overcast layer wins; scattered clouds do not set ceiling');
assert.equal(measured.ceiling_status,'measured');
assert.equal(measured.visibility,16093.44);
assert.equal(measured.observation_valid,true);
assert.equal(measured.stale,false);
assert.equal(reading({cloudLayers:[{amount:'OVC',base:q(1000,'wmoUnit:ft')}]}).ceiling,304.8);
assert.equal(reading({rawMessage:'KDFW 011200Z 1/2SM FG VV002 RMK BKN001'}).ceiling,60.96,'Raw VV uses hundreds of feet and ignores remarks');
assert.equal(reading({rawMessage:'KDFW 011200Z 10SM BKN010CB OVC030'}).ceiling,304.8);
assert.equal(reading({rawMessage:'KDFW 011200Z 10SM VV///'}).ceiling_status,'unavailable');
assert.equal(reading({cloudLayers:[{amount:'BKN',base:q(null)}]}).ceiling_status,'unavailable');
assert.equal(reading({cloudLayers:[]}).ceiling_status,'unavailable','Missing sky report is never clear sky');
assert.equal(reading({cloudLayers:[{amount:'CLR',base:q(3810)}]}).ceiling_status,'clear');
assert.equal(reading({rawMessage:'KDFW 011200Z 10SM SKC'}).ceiling_status,'clear');
assert.equal(reading({rawMessage:'KDFW 011200Z CAVOK'}).ceiling_status,'no-ceiling','CAVOK does not mean completely clear');
assert.equal(reading({cloudLayers:[{amount:'SCT',base:q(300)}]}).ceiling_status,'no-ceiling');
assert.equal(reading({visibility:q(0)}).visibility,0,'Zero visibility is an observation');
assert.equal(reading({visibility:q(null)}).visibility,null);
assert.equal(reading({visibility:q(3,'unknown')}).visibility,null,'Unknown units are not guessed');
assert.equal(reading({timestamp:'invalid'}).observation_valid,false);
assert.equal(reading({timestamp:new Date((now+3600)*1000).toISOString()}).observation_valid,false);
assert.equal(reading({timestamp:new Date((now-8000)*1000).toISOString()}).stale,true);
assert.equal(provider.shapeMetarObs(record({temperature:q(20)}),false,now).obs[0].air_temperature,68,'Existing comparison units preserved');
assert.equal(provider.shapeMetarObs(record({temperature:q(20)}),true,now).obs[0].air_temperature,20);
assert.equal(provider.cacheSeconds('https://mapservices.weather.noaa.gov/vector/rest/services/test/query'),1800);
assert.equal(provider.cacheSeconds('https://www.spc.noaa.gov/products/outlook/day1otlk_torn.nolyr.geojson'),1800);
assert.equal(provider.cacheSeconds('https://mapservices.weather.noaa.gov/query',new Headers({'Cache-Control':'max-age=60',Age:'20'})),40);
assert.equal(provider.cacheSeconds('https://mapservices.weather.noaa.gov/query',new Headers({'Cache-Control':'no-store'})),0);

// Exercise the supplementary route used by Tempest, whose amount interval is unspecified.
let requestedUrl;
const qpf = {
  timezone: 'America/Chicago', utc_offset_seconds: -21600,
  current: {time:3600}, hourly_units: {visibility:'m',wet_bulb_temperature_2m:'°F',precipitation:'inch'},
  hourly: {time:[3600],precipitation:[0.1],visibility:[1200],wet_bulb_temperature_2m:[65]},
  daily: {time:[0],precipitation_sum:[0.4]},
};
provider.qs = p => new URLSearchParams(p).toString();
provider.getJSON = async url => { requestedUrl = new URL(url); return qpf; };
vm.runInContext(apiSource.slice(apiSource.indexOf('export function dailyPrecip'), apiSource.indexOf('export function aqi')).replace(/^export /gm, ''), provider);
vm.runInContext(apiSource.slice(apiSource.indexOf('export function shapeOm'), apiSource.indexOf("// The station's reading")).replace(/^export /gm, ''), provider);
const supplemental = provider.shapeOm(await provider.dailyPrecip(32.75, -97.33));
assert.ok(requestedUrl.searchParams.get('hourly').split(',').includes('precipitation'), 'Tempest supplemental request must include hourly amounts');
assert.ok(requestedUrl.searchParams.get('hourly').split(',').includes('wet_bulb_temperature_2m'));
assert.equal(requestedUrl.searchParams.get('precipitation_unit'), 'inch');
const desk = vm.createContext({Date,timeStr:()=>''});
vm.runInContext(readFileSync(new URL('../site/js/forecast-desk.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''),desk);
const tempest = {_forecastSource:'Tempest',forecast:{daily:[{day_start_local:0}],hourly:[{time:3600,precip:0.7}]}};
const mixed = desk.withForecastContext(tempest,supplemental);
assert.equal(mixed.forecast.hourly[0].precip,0.1,'Known model accumulation replaces an unspecified Tempest interval');
assert.equal(mixed.forecast.hourly[0].precip_period,'preceding-hour');
assert.equal(mixed.forecast.hourly[0].precip_source,'Open-Meteo');
assert.equal(mixed.forecast.hourly[0].wet_bulb_temperature,65);
assert.equal(mixed.forecast.hourly[0].visibility,1200);
assert.equal(mixed.forecast.daily[0].precip_accum,0.4);
assert.equal(tempest.forecast.hourly[0].precip,0.7,'Supplement merge preserves the original provider payload');

const fields = ['soil_temperature_6cm','soil_temperature_18cm','soil_moisture_3_to_9cm','soil_moisture_9_to_27cm'];
const soil = (time, temp = 20) => ({hourly:{time:[time],soil_temperature_6cm:[temp],soil_temperature_18cm:[10],soil_moisture_3_to_9cm:[0.25],soil_moisture_9_to_27cm:[0]},hourly_units:Object.fromEntries(fields.map((f,i)=>[f,i<2?'°C':'m³/m³']))});
const c = vm.createContext({Date,URL}); vm.runInContext(source,c);
assert.equal(c.soilSnapshot(soil(now),false,now).temperature6,68);
assert.equal(c.soilSnapshot(soil(now),true,now).temperature6,20);
assert.equal(c.soilSnapshot(soil(now),true,now).moisture3to9,25);
assert.equal(c.soilSnapshot(soil(now),true,now).moisture9to27,0);
const missing = soil(now); missing.hourly.soil_temperature_6cm=[null]; missing.hourly.soil_moisture_3_to_9cm=[2];
assert.equal(c.soilSnapshot(missing,true,now).temperature6,null);
assert.equal(c.soilSnapshot(missing,true,now).moisture3to9,null);
assert.equal(c.soilSnapshot(soil(now-14400),true,now).stale,true);
assert.equal(c.soilSnapshot(soil(now+3600),true,now).time,null,'Future model hour is not current ground conditions');
assert.equal(c.soilSnapshot({},true,now).temperature6,null);

const elements = [], events = new Map();
class Element {
  constructor(tag) { this.tagName=tag; this.children=[]; this.handlers={}; this.text=''; this.open=false; elements.push(this); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children=children; this.text=''; }
  set textContent(text) { this.text=String(text); this.children=[]; }
  get textContent() { return this.text+this.children.map(c=>c.textContent).join(' '); }
  setAttribute() {}
  getClientRects() { return this.visible === false ? [] : [{}]; }
  addEventListener(name,fn) { this.handlers[name]=fn; }
}
let identity='home:imperial', latitude=32.75, units='imperial', requests=0, metarRequests=0;
const finishes=[];
const doc={hidden:false,createElement:tag=>new Element(tag),getElementById:id=>elements.find(e=>e.id===id),addEventListener(){}};
const ui=vm.createContext({Date,URL,document:doc,window:{addEventListener:(name,fn)=>events.set(name,fn)},
  settings:()=>({units}),coords:()=>({lat:latitude,lon:-97.33}),cacheContext:()=>identity,
  num:(n,p=0)=>Number.isFinite(n)?n.toFixed(p):'—',milesBetween:(lat,lon,a,b)=>Math.abs(lat-a)*69,
  api:{soilForecast:(lat,lon,u)=>{requests++;return new Promise(resolve=>finishes.push({lat,u,resolve}));},
    nwsPoint:async()=>({properties:{observationStations:'https://api.weather.gov/gridpoints/FWD/69,103/stations'}}),
    getJSON:async()=>({features:[{properties:{stationIdentifier:'KDFW',name:'Dallas airport'},geometry:{coordinates:[-97.33,32.76]}}]}),
    metarObs:async()=>{metarRequests++;return {obs:[measured]};}}});
vm.runInContext(source,ui);
const host = new Element('div'); ui.initForecastEnvironment(host); ui.initForecastEnvironment(host);
assert.equal(host.children.length,1,'Initialization is idempotent');
assert.equal(requests,0,'Collapsed panel fetches nothing');
const panel=doc.getElementById('forecast-environment-details'), settle=()=>new Promise(resolve=>setImmediate(resolve));
panel.open=true; panel.handlers.toggle(); await settle();
assert.equal(requests,1); assert.equal(metarRequests,1);
identity='away:metric';latitude=33;units='metric';events.get('wd:settings')();await settle();
assert.equal(requests,2,'Location or units change starts a fresh request');
finishes[1].resolve(soil(now,15));await settle();
assert.match(panel.textContent,/15.0 °C/);
finishes[0].resolve(soil(now,50));await settle();
assert.doesNotMatch(panel.textContent,/50.0|122.0/,'Slow response from previous location is ignored');
events.get('wd:forecast')();await settle();
assert.equal(requests,2,'Forecast events reuse recent panel data');
panel.open=false;identity='other:metric';events.get('wd:settings')();await settle();
assert.equal(requests,2,'Settings change never loads a collapsed panel');
assert.doesNotMatch(panel.textContent,/15.0 °C/,'Old-location values disappear immediately');
assert.equal(doc.getElementById('forecast-environment-details').open,false);
panel.open=true; panel.children[1].visible=false; identity='hidden:metric';
events.get('wd:settings')(); events.get('wd:forecast')(); await settle();
assert.equal(requests,2,'Open details in a hidden radar/history ancestor do not fetch');
panel.children[1].visible=true; events.get('wd:section')(); await settle();
assert.equal(requests,3,'Returning to the visible weather section resumes deferred loading');
finishes[2].resolve(soil(now,18)); await settle();
assert.match(panel.textContent,/18.0 °C/);
console.log('Forecast environment: soil units/nulls, METAR ceilings/visibility/age, Tempest supplement, cache policy, lazy loading and context races passed.');
