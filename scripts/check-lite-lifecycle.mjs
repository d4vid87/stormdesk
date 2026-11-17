import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { historyContext, recentHistory, rememberHistory, stationContext } from '../site/lite/history-cache.js';

const source=readFileSync(new URL('../site/lite/lite.js',import.meta.url),'utf8');
const historySource=readFileSync(new URL('../site/lite/history-view.js',import.meta.url),'utf8');
const apiImport=text=>text.match(/import \* as api from '([^']+)'/)[1];
assert.equal(apiImport(source),apiImport(historySource),'Lite and lazy History share one API module and request cache');
const nodes=new Map(), listeners={}, pending=[];
const $=selector=>{
  if(!nodes.has(selector))nodes.set(selector,{hidden:true,src:'',naturalWidth:1,attributes:{},close(){this.closed=true;},
    getAttribute(name){return name==='src'?this.src:this.attributes[name]},setAttribute(name,value){this.attributes[name]=value},removeAttribute(name){if(name==='src')this.src='';else delete this.attributes[name]}});
  return nodes.get(selector);
};
let place={lat:32,lon:-97}, refreshes=0;
const document={hidden:false};
const context=vm.createContext({$,document,Date,URLSearchParams,esc:String,age:()=> 'now',coords:()=>place,
  settings:()=>({places:[]}),window:{addEventListener:(name,fn)=>listeners[name]=fn},api:{alerts:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))},
  safeMode:()=>false,nearestSite:()=> 'KFWS',refresh:()=>{refreshes++;}});
vm.runInContext(source.slice(source.indexOf('const alertContext'),source.indexOf('function showPage')),context);
const body=name=>({features:[{properties:{event:name,severity:'Severe',expires:new Date(Date.now()+60000).toISOString()}}]});
const old=context.refreshAlerts();
place={lat:40,lon:-80};listeners['wd:settings']();
assert.equal($('#warningBanner').hidden,true,'moving locations immediately clears the old warning');
assert.equal($('#warningDialog').closed,true);
const fresh=context.refreshAlerts();pending[1].resolve(body('NEW'));await fresh;
pending[0].resolve(body('OLD'));await old;
assert.equal($('#warningBanner strong').textContent,'NEW','late warnings cannot replace the selected location');
const staleFailure=context.refreshAlerts(), good=context.refreshAlerts();pending[3].resolve(body('CURRENT'));await good;
pending[2].reject(Error('offline'));await staleFailure;
assert.equal($('#warningBanner').hidden,false,'a superseded failure cannot hide a newer warning');

vm.runInContext(source.slice(source.indexOf('function playRadar'),source.indexOf('function openDialog')),context);
$('#radarPage').hidden=false;context.playRadar();const url=$('#radarViewer').src;
assert.ok(url);document.hidden=true;context.visibilityChanged();
assert.equal($('#radarViewer').src,'','hidden Lite releases the live radar document');
context.playRadar();assert.equal($('#radarViewer').src,'','hidden Lite cannot load the viewer');
document.hidden=false;context.visibilityChanged();
assert.equal($('#radarViewer').src,url,'returning resumes the radar only when its page remains selected');
assert.equal(refreshes,1);
document.hidden=true;context.visibilityChanged();$('#radarPage').hidden=true;
document.hidden=false;context.visibilityChanged();assert.equal($('#radarViewer').src,'');

const memory=new Map();globalThis.localStorage={getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value)};
const station={stationSource:'ecowitt',stationId:'',activeStationProfile:'home',deviceId:'one',lat:32,lon:-97};
const key=historyContext(station,place), row={time:Date.now()/1000,tempC:20};
memory.set('wd.liteHistory.v1',JSON.stringify({context:key,rows:[row]}));
assert.deepEqual(recentHistory(key),[],'legacy records with no proven source identity stay unavailable');
rememberHistory(key,row);
assert.equal(recentHistory(key).length,1);
for(const [field,value] of Object.entries({deviceId:'two',activeStationProfile:'cabin',wllHost:'192.168.1.9',lacrosseEmail:'changed',ecowittMac:'other'})) {
  assert.notDeepEqual(stationContext({...station,[field]:value}),stationContext(station));
  assert.deepEqual(recentHistory(historyContext({...station,[field]:value},place)),[],`${field} isolates stored history`);
}
assert.ok(memory.has('wd.liteHistory.v1'),'legacy history is preserved rather than deleted');
console.log('Lite lifecycle: stale alerts discarded, hidden radar released, resumed view preserved, source-bound caches and legacy history retention passed.');
