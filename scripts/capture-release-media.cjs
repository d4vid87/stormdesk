// Capture the shipped UI with isolated sample weather; never opens the owner's profile.
// NODE_PATH=<Playwright node_modules> node scripts/capture-release-media.cjs
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const STEM = 'stormdesk-4121';

async function openCapture({viewport={width:1662,height:1164},recordVideo,baseURL}={}) {
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    const filename=path.resolve(ROOT,'site',`.${url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)}`);
    if(!filename.startsWith(path.join(ROOT,'site')+path.sep)||!fs.existsSync(filename)||!fs.statSync(filename).isFile()){res.writeHead(404);res.end();return;}
    const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.json':'application/json'}[path.extname(filename)]||'application/octet-stream';
    res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store'});fs.createReadStream(filename).pipe(res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=baseURL||`http://127.0.0.1:${server.address().port}`;
  const fc=new Function(fs.readFileSync(path.join(ROOT,'.github/ci/fixture.js'),'utf8').split("addEventListener('load'")[0]+'\nreturn fc;')();
  const now=Math.floor(Date.now()/1000);
  const day = Math.floor(now/86400)*86400+6*3600;
  fc.current_conditions.sea_level_pressure=29.95;
  fc.current_conditions.station_pressure=29.32;
  const icons=['partly-cloudy-day','clear-day','partly-cloudy-day','thunderstorm','rainy','cloudy','partly-cloudy-day','clear-day','rainy','partly-cloudy-day'];
  const words=['Partly Cloudy','Clear','Partly Cloudy','Thunderstorms','Rain','Cloudy','Partly Cloudy','Clear','Rain','Partly Cloudy'];
  fc.forecast.daily.forEach((d,i)=>Object.assign(d,{day_start_local:day+i*86400,sunrise:day+i*86400+6*3600+57*60,sunset:day+i*86400+17*3600+22*60,icon:icons[i],conditions:words[i],precip_probability:[5,0,10,70,60,20,10,0,45,15][i]}));
  fc.forecast.hourly=fc.forecast.hourly.filter(h=>h.time>=now);
  fc.forecast.hourly.forEach((h,i)=>{h.icon=i<4?'partly-cloudy-day':i<8?'clear-night':'rainy';h.conditions=i<8?'Partly Cloudy':'Rain';h.precip_source='Demo forecast';});
  const obs=Array.from({length:672},(_,i)=>[now-(671-i)*900,1,2+Math.sin(i/9),4+Math.abs(Math.sin(i/11))*3,180+Math.sin(i/13)*40,3,1012+Math.sin(i/16)*2,22+Math.sin(i/8)*4,60+Math.sin(i/8)*12,20000,3,350,i%50===0?0.4:0,0,0,0,2.71,1,3]);
  const browser=await chromium.launch({executablePath:process.env.CHROME||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({viewport,deviceScaleFactor:1,...(recordVideo?{recordVideo:{dir:recordVideo,size:viewport}}:{})});
  await context.addInitScript(()=>{if(!localStorage.getItem('wd.settings'))localStorage.setItem('wd.settings',JSON.stringify({token:'demo-not-a-real-token',stationId:'1',deviceId:'1',deviceSerial:'ST-DEMO',serialDeviceId:'1',stationName:'Fort Worth · DEMO DATA',units:'imperial',theme:'dark',palette:'graphite',deskStyle:'observatory',gaugeStyle:'orbit',lat:32.75,lon:-97.33,deskRadar:false,nightDim:false,kioskCycleSec:0,eco:'off',nearbyRadius:0,notif:{enabled:false},motion:'full'}));});
  await context.routeWebSocket('wss://ws.weatherflow.com/**',ws=>ws.onMessage(()=>ws.send(JSON.stringify({type:'rapid_wind',ob:[now,3.2,190]}))));
  await context.route('**/*',async route=>{
    const u=new URL(route.request().url());let body;
    if(u.hostname==='swd.weatherflow.com'){
      if(u.pathname.includes('better_forecast'))body=fc;
      else if(u.pathname.includes('observations/device'))body={obs};
      else if(u.pathname.includes('observations/stn'))body={obs:[{...fc.current_conditions,timestamp:now}]};
      else body={stations:[{station_id:1,name:'Fort Worth · DEMO DATA',latitude:32.75,longitude:-97.33,devices:[{device_id:1,device_type:'ST',serial_number:'ST-DEMO'}]}]};
    } else if(u.hostname==='air-quality-api.open-meteo.com')body={hourly:{time:[new Date(now*1000).toISOString()],us_aqi:[32],pm2_5:[4.2]}};
    else if(u.hostname==='api.weather.gov')body={features:[],properties:{periods:[]}};
    else if(u.hostname.includes('open-meteo.com'))body={hourly:{time:[]},daily:{time:[],precipitation_sum:[],sunshine_duration:[]}};
    else if(u.origin===origin&&u.pathname==='/history/tuples')body={obs};
    else if(u.origin===origin&&/^\/(config|health|diag|events|udp)/.test(u.pathname))return route.fulfill({status:404,body:''});
    if(body!==undefined)return route.fulfill({json:body});
    return route.continue();
  });
  const videoStartedAt=Date.now();
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/#desk',{waitUntil:'domcontentloaded'});
  await page.locator('#desk-customize').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelectorAll('#daycards .daycard').length===10);
  await page.waitForTimeout(900);
  assert.equal(await page.locator('#hero-temp').textContent(),'72°');
  const reset=async()=>page.evaluate(async()=>{
    const app=await import('./js/app.js'),layout=await import('./js/desk-layout.js');
    document.querySelectorAll('dialog[open]').forEach(d=>d.close());
    app.saveSettings({deskLayout:layout.defaultDeskLayout(),palette:'graphite',theme:'dark',deskStyle:'observatory',gaugeStyle:'orbit',deskRadar:false});app.applyTheme();
    document.querySelector('.tab[data-section="desk"]').click();
  });
  const close=async()=>{await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));};
  return {page,context,browser,origin,errors,reset,close,forecast:fc,videoStartedAt};
}
module.exports={openCapture,ROOT,STEM};

async function capture() {
  const c=await openCapture(),p=c.page;
  const out=path.join(ROOT,'shots','release-4121');fs.mkdirSync(out,{recursive:true});
  const manifest=[];
  const shot=async(name,locator)=>{
    const file=`${STEM}-${name}.jpg`,dest=path.join(ROOT,'docs',file);
    await p.waitForTimeout(250);
    if(locator)await p.locator(locator).screenshot({path:dest,type:'jpeg',quality:88});
    else await p.screenshot({path:dest,type:'jpeg',quality:88});
    fs.copyFileSync(dest,path.join(ROOT,'marketing/images',file));manifest.push(file);
  };
  try {
    await shot('weather');
    await p.locator('#desk-customize').click();await shot('layout-picker');
    await p.getByLabel('Arrange',{exact:true}).selectOption('gauges');
    await p.getByLabel('Move Wind earlier',{exact:true}).click();await p.getByLabel('Move Wind earlier',{exact:true}).click();
    await shot('layout-editor');
    await p.getByLabel('Navigation location',{exact:true}).selectOption('left');
    await p.getByLabel('Icon position',{exact:true}).selectOption('above');
    await p.getByRole('button',{name:'Done',exact:true}).click();await shot('arranged');
    await p.locator('#desk-customize').click();await p.locator('[data-customize-tab="themes"]').click();await shot('themes-picker');
    await p.locator('[data-customize-tab="style"]').click();await shot('desk-styles');
    await c.reset();await p.waitForTimeout(400);
    for(const [name,key]of [['violet','violet'],['abyss','abyss'],['copper','copper'],['light','light']]){
      await p.locator('#desk-customize').click();await p.locator('[data-customize-tab="themes"]').click();await p.locator(`[data-theme-choice="${key}"]`).click();await p.getByRole('button',{name:'Done',exact:true}).click();await shot(`theme-${name}`);
    }
    await c.reset();await p.waitForTimeout(400);
    await p.locator('#gauge-style').click();await shot('gauge-picker');await p.getByLabel('Close gauge styles',{exact:true}).click();
    for(const [name,key] of [['orbit','orbit'],['liquid','chrome'],['neon','neon'],['dial','dial'],['pixel','pixel']]){
      await p.locator('#gauge-style').click();await p.locator(`[data-gauge-style="${key}"]`).click();await shot(`gauge-${name}`,'#gauges');
    }
    await c.reset();await p.locator('.tab[data-section="data"]').click();await p.waitForTimeout(900);await shot('history');
    await p.locator('#btn-settings').click();await shot('settings');await p.locator('[data-settings-category="appearance"]').click();await shot('appearance');await p.locator('.settings-close').click();
    await c.reset();await p.setViewportSize({width:390,height:844});await p.waitForTimeout(500);await shot('mobile');
    await p.setViewportSize({width:1662,height:1164});await c.reset();
    await p.locator('.tab[data-section="lab"]').click();await p.waitForTimeout(14000);await shot('radar');
    fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({files:manifest,errors:c.errors},null,2));
    console.log(JSON.stringify({files:manifest,errors:c.errors},null,2));
  } finally { await c.close(); }
}
if(require.main===module)capture().catch(e=>{console.error(e);process.exitCode=1;});
