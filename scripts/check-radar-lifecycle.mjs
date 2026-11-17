import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../site/js/boot.js',import.meta.url),'utf8');
function harness() {
  const listeners={}, observers=new Set(), idle=new Map(), jobs=new Map();
  let serial=0;
  const nodes=Object.fromEntries(['desk-radar','desk-radar-frame','desk-radar-still','desk-radar-caption','desk','lab','lab-frame','drawer','wizard','outlook-astronomy'].map(id=>[id,{id,src:'',hidden:true,style:{},classList:{classes:new Set(id==='desk'?['active']:[]),contains(c){return this.classes.has(c)},add(c){this.classes.add(c)},remove(c){this.classes.delete(c)},toggle(c,v){v?this.classes.add(c):this.classes.delete(c)}},removeAttribute(name){this[name]=''},toggleAttribute(name,value){this[name]=value}}]));
  nodes['desk-radar'].hidden=false;
  const document={hidden:false,addEventListener:(name,fn)=>{listeners[name]=fn},querySelectorAll:()=>[]};
  const context=vm.createContext({console,Date,URLSearchParams,document,window:{addEventListener:(name,fn)=>{listeners[name]=fn},requestIdleCallback:true},
    $:id=>nodes[id],settings:()=>({deskRadar:true,stormAuto:false}),stormOverride:false,ecoOn:()=>false,motionLevel:()=> 'full',safeMode:()=>false,
    radarAlive:()=>{},radarWatchdog:()=>{},radarUrl:()=> 'https://app.hookecho.io/?embed#goto=KFWS,-97,32,7',
    every:(name,seconds,fn)=>{jobs.set(name,fn);if(!document.hidden)fn()},clearJob:name=>jobs.delete(name),
    requestIdleCallback:fn=>{idle.set(++serial,fn);return serial},cancelIdleCallback:id=>idle.delete(id),
    setTimeout:fn=>{idle.set(++serial,fn);return serial},clearTimeout:id=>idle.delete(id),
    IntersectionObserver:class {constructor(fn){this.fn=fn;observers.add(this)}observe(){}disconnect(){observers.delete(this)}}});
  vm.runInContext(source.slice(source.indexOf('// lazy-load the Lab iframe'),source.indexOf('// Not awaited at the top level')),context);
  const section=name=>{for(const id of ['desk','lab'])nodes[id].classList.toggle('active',id===name);listeners['wd:section']({detail:name})};
  return {context,nodes,document,listeners,observers,idle,jobs,section};
}
const a=harness();
for (let i=0;i<100;i++) {
  a.section('desk');
  assert.equal(a.observers.size,1,'the visible desk arms one observer');
  a.section('history');
  assert.equal(a.observers.size,0,'leaving the desk releases its pending observer');
}
assert.equal(a.idle.size,0);
a.section('desk');
[...a.observers][0].fn([{isIntersecting:true}]);
assert.equal(a.observers.size,0);assert.equal(a.idle.size,1);
a.section('history');
assert.equal(a.idle.size,0,'leaving cancels queued radar startup');
a.section('desk');
[...a.observers][0].fn([{isIntersecting:true}]);
a.document.hidden=true;a.listeners.visibilitychange();
assert.equal(a.idle.size,0,'hiding cancels queued radar startup');
assert.equal(a.nodes['desk-radar-frame'].src,'');
a.document.hidden=false;a.listeners.visibilitychange();
assert.equal(a.observers.size,1,'resuming re-arms the active desk');
[...a.observers][0].fn([{isIntersecting:true}]);
const start=[...a.idle.values()][0];a.idle.clear();start();
const camera=a.nodes['desk-radar-frame'].src;
assert.match(camera,/goto=KFWS/);
a.document.hidden=true;a.listeners.visibilitychange();
assert.equal(a.nodes['desk-radar-frame'].src,'','hidden desk releases the radar document');
a.document.hidden=false;a.listeners.visibilitychange();
[...a.observers][0].fn([{isIntersecting:true}]);
[...a.idle.values()][0]();a.idle.clear();
assert.equal(a.nodes['desk-radar-frame'].src,camera,'resuming restores the saved camera URL');
a.section('lab');
assert.equal(a.nodes['desk-radar-frame'].src,'');assert.ok(a.nodes['lab-frame'].src);
a.document.hidden=true;a.listeners.visibilitychange();
assert.equal(a.nodes['lab-frame'].src,'','hidden Lab releases the radar document');
a.document.hidden=false;a.listeners.visibilitychange();
assert.ok(a.nodes['lab-frame'].src,'resuming Lab restores its radar');
assert.equal(a.nodes['desk-radar-frame'].src,'','resuming never loads both radar views');
a.section('history');a.document.hidden=true;a.listeners.visibilitychange();
a.document.hidden=false;a.listeners.visibilitychange();
assert.equal(a.nodes['lab-frame'].src,'');assert.equal(a.observers.size,0);
console.log('Radar lifecycle: 100 navigation cycles retain 0 observers; hidden radar documents 1 → 0; pending startup cancels and only the active view resumes.');
