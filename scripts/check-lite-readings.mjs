import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync('site/lite/lite.js', 'utf8');
let s = { stationId: '123', token: 'test', stationName: 'Backyard', units: 'imperial', lat: 33, lon: -97, places: [] };
let rendered, fails = false, forecastFails = false;
const memory = new Map();
const context = vm.createContext({ console, structuredClone, Date, URLSearchParams,
  settings: () => s, saveSettings: p => Object.assign(s, p), coords: () => s.places.find(p=>p.id===s.activePlace)||s,
  localStorage: { getItem:k=>memory.get(k)||null, setItem:(k,v)=>memory.set(k,v) },
  render:v=>{rendered=v}, openDialog:()=>{}, refreshAlerts:()=>{},
  api:{stationObs:async()=>{if(fails)throw Error('401');return {obs:[{timestamp:Date.now()/1000,air_temperature:82,relative_humidity:0}]};},betterForecast:async()=>{if(forecastFails)throw Error('offline');return {current_conditions:{air_temperature:99},forecast:{daily:[],hourly:[]}};}}
});
vm.runInContext(source.slice(source.indexOf('let latest'),source.indexOf('const icon')),context);
vm.runInContext(source.slice(source.indexOf('function renderWeather'),source.indexOf('async function refreshAlerts')),context);
await vm.runInContext('refresh()',context);assert.equal(rendered.current_conditions.air_temperature,82);assert.equal(rendered.current_conditions.relative_humidity,0);assert.equal(rendered.current_conditions.wind_avg,null);
forecastFails=true;await vm.runInContext('refresh()',context);assert.equal(rendered.current_conditions.air_temperature,82);
fails=true;await vm.runInContext('refreshObservation()',context);assert.equal(rendered.current_conditions.air_temperature,82);assert.equal(vm.runInContext('observationError',context),'Check station credentials');
vm.runInContext("browsePlace(40,-74,'New York')",context);assert.equal(s.stationName,'Backyard');assert.equal(s.lat,33);await vm.runInContext('refreshObservation()',context);assert.equal(rendered._station,undefined);
const startup=source.slice(source.indexOf('  const lat = Number(initial'),source.indexOf("  $('#unitsSelect')",source.indexOf('async function start')));
for (const q of ['', '?lat=&lon=', '?lat=91&lon=0', '?lat=20', '?lat=x&lon=3']) {s.activePlace=null;vm.runInContext(`{ const initial=new URLSearchParams(${JSON.stringify(q)});${startup}}`,context);assert.equal(s.activePlace,null);assert.equal(s.lat,33);}
vm.runInContext(`{ const initial=new URLSearchParams('lat=0&lon=0&name=Zero');${startup}}`,context);assert.equal(s.activePlace,'lite-browse');assert.equal(s.stationName,'Backyard');
console.log('Lite observations: real readings, zero/missing values, independent outages, retained readings and location preservation passed');

const apiSource = readFileSync('site/js/api.js', 'utf8');
vm.runInContext(apiSource.slice(apiSource.indexOf('export function normalizeStationObs'), apiSource.indexOf('export async function stationObs')).replace('export ', ''), context);
const normalized = vm.runInContext("normalizeStationObs({ob_fields:['timestamp','air_temp','rh','wind_dir','local_day_precip_accumulation'],obs:[[123,82,0,180,0]]})", context);
assert.equal(normalized.obs[0].timestamp,123);
assert.equal(normalized.obs[0].air_temperature,82);
assert.equal(normalized.obs[0].relative_humidity,0);
assert.equal(normalized.obs[0].wind_direction,180);
assert.equal(normalized.obs[0].precip_accum_local_day,0);
assert.equal(vm.runInContext("normalizeStationObs({obs:[{timestamp:123,air_temperature:80}]}).obs[0].air_temperature",context),80);
console.log('Tempest field-indexed and named observations passed');
