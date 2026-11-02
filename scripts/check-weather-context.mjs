import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { readingInfo, modelAgreement } from '../site/js/weather-context.js';

const now = Date.UTC(2026, 0, 1), start = now / 1000;
const fc = { _cached: true, _savedAt: now, current_conditions: { time: start - 3600, _sources: {
  air_temperature: { name: 'Station observation', at: start - 120 },
} } };
assert.match(readingInfo(fc, 'air_temperature', now), /Saved data · Station observation · 2 min old/);
assert.match(readingInfo(fc, 'dew_point', now), /Forecast estimate · 60 min old/);
assert.match(readingInfo(fc, 'wbgt', now), /Calculated estimate/);
assert.match(readingInfo({}, 'wind_avg', now), /time unavailable/);
const live = structuredClone(fc); live.current_conditions._sources.air_temperature.at = start + 60;
assert.ok(!readingInfo(live, 'air_temperature', now + 60000).includes('Saved data'), 'new station data is not labelled as saved forecast');
const models = { hourly: { time: [start, start + 3600, 'invalid'], temperature_2m_a: [20, 21, 0], temperature_2m_b: [21, 26, 100] } };
assert.match(modelAgreement(models, start, start + 86400, true), /Wide.*5.0°C.*2 comparable hours/);
assert.match(modelAgreement(models, start + 86400, start + 172800), /unavailable/);
assert.match(modelAgreement({utc_offset_seconds:-21600,hourly:{time:['2025-12-31T18:00'],temperature_2m_a:[20],temperature_2m_b:[21]}},start,start+3600,true), /1 comparable hours/, 'model day alignment uses provider offset, not browser timezone');
assert.match(modelAgreement({ hourly: { time: [start], temperature_2m_a: [10] } }, start, start + 1), /unavailable/);

const source = readFileSync(new URL('../site/js/api.js', import.meta.url), 'utf8');
let time = now, calls = 0, response = () => new Response('{"value":1}');
const cacheListeners = {}, stationSettings = {stationSource:'',deviceId:'1',stationId:'1'};
const context = vm.createContext({ URL, structuredClone, console, Date: class extends Date { static now() { return time; } },
  settings: () => stationSettings, addEventListener: (name, fn) => { cacheListeners[name] = fn; },
  location: { href: 'https://local.test/' }, expires: () => undefined, errHint: () => '',
  fetch: async (...args) => { calls++; return response(...args); },
});
vm.runInContext(source.slice(source.indexOf('const etags ='), source.indexOf("if (location.search.includes('selftest'))")).replace(/^export /gm, ''), context);
const { getJSON, cacheSeconds } = context;
const u = 'https://api.open-meteo.com/v1/forecast?models=a,b';
assert.equal(cacheSeconds(u, new Headers()), 900);
assert.equal(cacheSeconds('https://api.weather.gov/points/35,-97', new Headers()), 86400);
assert.equal(cacheSeconds(u, new Headers({ 'Cache-Control': 'max-age=60', Age: '10' })), 50);
assert.equal(cacheSeconds(u, new Headers({ 'Cache-Control': 'no-store' })), 0);
const [a, b] = await Promise.all([getJSON(u), getJSON(u)]);
assert.equal(calls, 1); a.value = 5; assert.equal(b.value, 1);
time += 899000; await getJSON(u); assert.equal(calls, 1);
time += 2000; await getJSON(u); assert.equal(calls, 2);
stationSettings.wllHost='192.168.1.2'; await getJSON(u); assert.equal(calls,3,'changing station identity bypasses old cached data');
cacheListeners['wd:archive-change'](); await getJSON(u); assert.equal(calls,4,'archive mutation invalidates cached readings');
for (const retry of ['120', new Date(time + 120000).toUTCString()]) {
  const url = 'https://local.test/rate/' + calls;
  response = () => new Response('{}', { status: 429, headers: { 'Retry-After': retry } });
  await assert.rejects(getJSON(url), /429/); const before = calls;
  await assert.rejects(getJSON(url), /retry after/); assert.equal(calls, before);
  time += 121000; response = () => new Response('{}');
  await getJSON(url); assert.equal(calls, before + 1);
}
response = () => new Response('{}', { headers: { 'Cache-Control': 'no-store' } });
const before = calls; await getJSON('/uncached'); await getJSON('/uncached'); assert.equal(calls, before + 2);

const nws = 'https://api.weather.gov/points/35,-97';
response = () => new Response('{"v":1}', {headers:{ETag:'one','Cache-Control':'max-age=10'}});
await getJSON(nws);time+=11000;
response = (_,opts) => {assert.equal(opts.headers['If-None-Match'],'one');return new Response(null,{status:304});};
await getJSON(nws);const revalidated=calls;time+=11000;
await getJSON(nws);assert.equal(calls,revalidated+1,'304 without new policy retains the shorter provider lifetime');

const desk = readFileSync(new URL('../site/js/desk.js', import.meta.url), 'utf8');
const events = [], saved = { value: 1 };
const c = vm.createContext({ Date, cacheContext: () => 'test', load: () => saved, store: (_, j) => events.push(['stored', j.value]) });
vm.runInContext(desk.slice(desk.indexOf('async function cached('), desk.indexOf('// One toast')), c);
let finish;
const pending = c.cached('forecast', () => new Promise(resolve => { finish = resolve; }), j => events.push(['paint', j.value]));
assert.deepEqual(events, [['paint', 1]], 'saved weather paints before the network finishes');
finish({ value: 2 }); assert.equal((await pending).fresh, true);
assert.deepEqual(events.at(-1), ['stored', 2]);
assert.equal((await c.cached('forecast', () => Promise.reject(Error('offline')))).fresh, false);
const pro = readFileSync(new URL('../site/js/pro.js', import.meta.url), 'utf8');
const frames = new Map(), listeners = {}, rendered = [];
let frameId = 0, active = true;
const document = {hidden:false, addEventListener:(name,fn)=>{listeners[name]=fn;}};
const ui = vm.createContext({
  document, window:{addEventListener:(name,fn)=>{listeners[name]=fn;}},
  $:()=>({classList:{contains:()=>active}}), deskForecast:()=>null,
  requestAnimationFrame:fn=>{frames.set(++frameId,fn);return frameId;},
  cancelAnimationFrame:id=>frames.delete(id),
  renderHero:fc=>rendered.push(fc.id), renderGauges:()=>{},
  renderPro:fc=>rendered.push('full:'+fc.id), renderLocal:o=>rendered.push('local:'+o[0]),
});
vm.runInContext(pro.slice(pro.indexOf('let pendingRender ='), pro.indexOf('// One dot per station')), ui);
const frame=()=>{const work=[...frames.values()];frames.clear();work.forEach(fn=>fn());};
ui.queueRender({id:1}); ui.queueRender({id:2}); ui.queueRender({id:3});
assert.equal(frames.size,1);frame();assert.deepEqual(rendered,[3]);
active=false; ui.queueRender({id:4}); assert.equal(frames.size,0);
active=true; listeners['wd:section']({detail:'desk'});frame();
assert.equal(rendered.at(-1),'full:4');
ui.queueRender({id:5}); listeners['wd:forecast']({detail:{id:6}});frame();
assert.equal(rendered.at(-1),'full:6','new forecasts cancel older queued frames');
document.hidden=true;ui.queueRender({localObs:[7]});assert.equal(frames.size,0);
document.hidden=false;listeners.visibilitychange();frame();assert.equal(rendered.at(-1),'local:7');
{
  const nodes = Object.fromEntries(['aqi-val','aqi-label','aqi-detail'].map(id => [id,{textContent:'',className:'',dataset:{}}]));
  const aqiListeners = {};
  let place = {lat:35,lon:-97}, resolveAqi, stamps = 0;
  const payload = value => ({hourly:{time:[new Date(now - 3600000).toISOString(),new Date(now + 3600000).toISOString()],us_aqi:[value,99],pm2_5:[5,6]}});
  const aqi = vm.createContext({
    Date: class extends Date { constructor(value) { super(value === undefined ? now : value); } },
    coords:()=>place, $:id=>nodes[id], num:String,
    window:{addEventListener:(type,fn)=>{aqiListeners[type]=fn;}},
    stamp:()=>{stamps++;nodes['aqi-val'].dataset.ts=String(now);},
    api:{aqi:()=>new Promise(resolve=>{resolveAqi=resolve;})},
  });
  vm.runInContext(desk.slice(desk.indexOf('const aqiLocation ='),desk.indexOf('export async function refreshObs')).replace(/^export /gm,''),aqi);
  let request = aqi.refreshAqi();
  resolveAqi(payload(32)); await request;
  assert.equal(nodes['aqi-val'].textContent,'32');
  assert.equal(nodes['aqi-label'].textContent,'Good');
  aqiListeners['wd:settings']();
  assert.equal(nodes['aqi-val'].textContent,'32','unrelated settings retain current-location AQI');
  request = aqi.refreshAqi();
  place = {lat:40,lon:-80}; aqiListeners['wd:settings']();
  assert.equal(nodes['aqi-val'].textContent,'--','location changes immediately clear the source value');
  assert.equal(nodes['aqi-label'].textContent,'Unavailable');
  assert.equal(nodes['aqi-val'].dataset.ts,undefined);
  resolveAqi(payload(20)); await request;
  assert.equal(nodes['aqi-val'].textContent,'--','old-location requests cannot publish into the new location');
  assert.equal(stamps,1,'discarded data is not marked fresh');
  request = aqi.refreshAqi(); resolveAqi(payload(null)); await request;
  assert.equal(nodes['aqi-label'].textContent,'Unavailable','missing AQI never becomes Good');
  assert.equal(nodes['aqi-val'].dataset.ts,undefined,'missing AQI has no freshness timestamp');
  request = aqi.refreshAqi(); resolveAqi(payload(80)); await request;
  assert.equal(nodes['aqi-val'].textContent,'80','new-location data resumes normally');
  assert.equal(nodes['aqi-label'].textContent,'Moderate');

  const balanced = readFileSync(new URL('../site/js/balanced-desk.js',import.meta.url),'utf8');
  nodes['aqi-val'].classList = {contains:()=>true};
  const air = {main:{},summary:{}}, summary = vm.createContext({$:id=>nodes[id],air,soil:null,num:String,U:{temp:()=> '°F'}});
  vm.runInContext(balanced.slice(balanced.indexOf('  function renderAir()'),balanced.indexOf('  new MutationObserver(renderAir)'))+'renderAir();',summary);
  assert.equal(air.main.textContent,'Air quality outdated','stale source values cannot appear current in the summary');
  assert.match(balanced,/attributeFilter:\['class', 'data-ts'\]/,'summary observes source freshness changes');
}
console.log('Weather context: source freshness, location-safe AQI, model coverage, retry backoff, isolated caches and immediate saved weather passed.');
