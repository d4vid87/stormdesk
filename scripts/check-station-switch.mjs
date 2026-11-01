import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../site/js/boot.js',import.meta.url),'utf8');
const functionBody=name=>{
  const start=source.indexOf('async function '+name+'(');
  assert.ok(start>=0);
  return source.slice(start,source.indexOf('\n}',start)+2);
};
const profiles=vm.createContext({});
vm.runInContext(source.slice(source.indexOf('const PROFILE_KEYS ='),source.indexOf('function renderStations()')),profiles);
const profile=profiles.stationProfile({lat:null,lon:null,elevationM:null,rules:[]});
assert.equal(profile.elevationM,null,'unknown elevation must not become sea level');
assert.equal(profile.lat,null);assert.equal(profile.lon,null);
const selector={disabled:false}, notices=[];
let state={stationId:'A',activeStationProfile:'a',savedStations:[],rules:[]}, finish;
let saves=0, refreshes=0, hydrations=0;
const context=vm.createContext({
  $:()=>selector, settings:()=>state, saveSettings:patch=>{state={...state,...patch};},
  stationProfile:s=>({...s}), profileIdentity:s=>s.stationId,
  pushConfig:()=>{saves++;return new Promise(resolve=>{finish=resolve;});},
  hydrateStation:async()=>{hydrations++;}, clearTimeout(){},pushTimer:null,
  store(){},fillDrawer(){},renderStations(){},refreshAll(){refreshes++;},
  notify:message=>notices.push(message),radarView:null,
});
vm.runInContext(functionBody('switchStation'),context);
const switching=context.switchStation({id:'b',profile:{stationId:'B',rules:[]}});
assert.equal(selector.disabled,true);
await context.switchStation({id:'c',profile:{stationId:'C'}});
assert.equal(state.stationId,'B');assert.equal(saves,1,'rapid switches cannot race');
finish(false);await switching;
assert.equal(state.stationId,'A','failed config write restores previous station');
assert.equal(selector.disabled,false);assert.equal(refreshes,0);assert.equal(hydrations,0);assert.equal(notices.length,1);

let resolveStation;
context.configured=()=>true;
context.api={station:()=>new Promise(resolve=>{resolveStation=resolve;})};
vm.runInContext(functionBody('hydrateStation'),context);
const oldLookup=context.hydrateStation();state={...state,stationId:'B'};
resolveStation({stations:[{name:'Old station',latitude:1,longitude:2,devices:[]}]});
await oldLookup;
assert.equal(state.stationId,'B');assert.equal(state.stationName,undefined,'late station lookup cannot overwrite the new selection');
console.log('Station switching: rollback, overlapping switches and stale lookup checks passed.');
