const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 const fc=new Function(fs.readFileSync('.github/ci/fixture.js','utf8').split("addEventListener('load'")[0]+'\nreturn fc')();
 for(const count of [1,2]){
  const context=await browser.newContext({viewport:{width:1280,height:800}});
  await context.route('https://swd.weatherflow.com/**',route=>{
   const path=new URL(route.request().url()).pathname;
   const station={station_id:123,name:'Onboarding fixture',latitude:32.9,longitude:-97.03,station_meta:{elevation:187},devices:[{device_id:456,device_type:'ST'}]};
   let data=path.includes('observations/stn')?{obs:[{...fc.current_conditions,timestamp:Math.floor(Date.now()/1000)}]}:path.includes('better_forecast')?fc:path.includes('observations/device')?{obs:[]}:{stations:path.endsWith('/stations')?Array.from({length:count},(_,i)=>({...station,station_id:123+i})): [station]};
   return route.fulfill({json:data});
  });
  await context.route('https://api.weather.gov/**',route=>route.fulfill({json:{features:[]}}));
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8097/?full=1');
  await page.locator('#btn-wiz-station').click();await page.locator('#wiz-token').fill('fixture-token');await page.locator('#btn-wiz-find').click();
  if(count===2){await page.waitForFunction(()=>document.querySelectorAll('#wiz-list button').length===2);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('wd.settings')).stationId),'');await page.locator('#wiz-list button').first().click()}
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('wd.settings')).deviceId==='456');
  const saved=await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('wd.settings'));return {id:s.stationId,lat:s.lat,lon:s.lon,elevation:s.elevationM,active:s.activePlace}});
  assert.deepEqual(saved,{id:'123',lat:32.9,lon:-97.03,elevation:187,active:null});
  const site=await page.evaluate(async()=>{const b=await import('./js/boot.js');const s=await (await fetch('sites.json')).json();return b.nearestSite(32.9,-97.03,s).id});assert.equal(site,'KFWS');
  await page.waitForFunction(()=>document.getElementById('wizard').hidden);
  await page.waitForFunction(()=>document.getElementById('desk-radar-frame').src.includes('#goto=KFWS,'));
  await page.locator('#btn-settings').click();
  await page.locator('[data-settings-category="station"]').click();
  await page.locator('#instrument-connect').click();
  await page.locator('#wiz-token').fill('edited-fixture-token');assert.equal(await page.locator('#wiz-list button').count(),0);
  assert.deepEqual(errors,[]);await context.close();
 }
 await browser.close();console.log('PASS: single-station auto import, multiple-station choice, sensor/location/elevation, KFWS excluding TDWR, automatic radar startup, token edit invalidation');
})().catch(e=>{console.error(e);process.exit(1)});
