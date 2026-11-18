import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../site/js/api.js', import.meta.url), 'utf8');
const now = Date.UTC(2026, 10, 17, 18), listeners = {};
let state = {stationSource:'ecowitt', stationId:'a', deviceId:'one', activeStationProfile:'home', lat:32, lon:-97, units:'imperial'};
const base = {...state};
const model = {current:{time:now/1000,temperature_2m:68,relative_humidity_2m:50},hourly:{},daily:{}};
const context = vm.createContext({
  Date:class extends Date {static now(){return now;}}, URLSearchParams,
  settings:()=>state, coords:()=>({lat:state.lat,lon:state.lon}), qs:obj=>new URLSearchParams(obj).toString(),
  windUnit:()=>state.windUnit || (state.units==='metric'?'kmh':'mph'),
  WIND_UNITS:{mph:{fromMs:2.236936,om:'mph'},kmh:{fromMs:3.6,om:'kmh'},ms:{fromMs:1,om:'ms'}},
  window:{addEventListener:(name,fn)=>{listeners[name]=fn}},getJSON:async()=>structuredClone(model),
});
const functionBody = name => {
  const start=source.indexOf(`export function ${name}(`);
  assert.ok(start>=0);return source.slice(start,source.indexOf('\n}',start)+2);
};
vm.runInContext([
  source.slice(source.indexOf('export const OBS ='),source.indexOf('// history:')),
  functionBody('siToDisplay'),
  source.slice(source.indexOf('let lastTuple ='),source.indexOf('export function soilForecast')),
].join('\n').replace(/^export /gm,''),context);
const tuple=Array(19).fill(null);tuple[0]=now/1000;tuple[7]=25;tuple[2]=2;
listeners['wd:ws-obs']({detail:tuple});
assert.equal((await context.omForecast()).current_conditions.air_temperature,77,'current home observations overlay the model');
state={...base,units:'metric'};
assert.equal((await context.omForecast()).current_conditions.air_temperature,25,'unit changes retain raw SI observations and convert once');
state={...base,windUnit:'ms'};
assert.equal((await context.omForecast()).current_conditions.wind_avg,2,'independent wind units remain correct');
for(const [key,value] of Object.entries({stationSource:'davis',stationId:'b',deviceId:'two',activeStationProfile:'cabin',wllHost:'192.168.1.9',lacrosseEmail:'changed',ecowittMac:'new-device',ingestKey:'changed',awnApiKey:'changed',lat:40,lon:-80})) {
  state={...base,[key]:value};
  assert.equal((await context.omForecast()).current_conditions.air_temperature,68,`${key} changes cannot reuse old-station observations`);
}
state={...base,activePlace:'away'};
assert.equal((await context.omForecast()).current_conditions.air_temperature,68,'away places never use the home station');
state={...base};
for(const seconds of [601,-301]) {
  const stale=[...tuple];stale[0]=now/1000-seconds;
  listeners['wd:ws-obs']({detail:stale});
  assert.equal((await context.omForecast()).current_conditions.air_temperature,77,'stale or future packets preserve the last good current observation');
}
const skew=[...tuple];skew[0]=now/1000+300;listeners['wd:ws-obs']({detail:skew});
assert.equal((await context.omForecast()).current_conditions.air_temperature,77,'bounded clock skew remains supported');
console.log('Station overlay: source/profile/location isolation, SI unit changes, away places and invalid timestamps passed.');
