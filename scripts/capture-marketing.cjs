// Run against `python3 -m http.server 8094 --directory site` with Playwright installed.
// Samples stay inside this browser context; no station credentials or production data are used.
const fs = require('node:fs');
const { chromium } = require('playwright');
(async () => {
  const fc = new Function(fs.readFileSync('.github/ci/fixture.js', 'utf8').split("addEventListener('load'")[0] + '\nreturn fc;')();
  const now = Math.floor(Date.now()/1000);
  // The CI fixture uses UTC midnight; these demo captures are centered on Texas.
  const zone = new Intl.DateTimeFormat('en-US', {timeZone:'America/Chicago',timeZoneName:'shortOffset'})
    .formatToParts(new Date()).find(part => part.type==='timeZoneName').value;
  const shift = -Number(zone.match(/GMT([+-]\d+)/)?.[1] || 0)*3600;
  fc.forecast.daily.forEach(day => { day.day_start_local += shift; day.sunrise += shift; day.sunset += shift; });
  fc.current_conditions.sea_level_pressure = 29.95;
  fc.forecast.hourly = fc.forecast.hourly.filter(h=>h.time>=now);
  const obs = Array.from({length:336},(_,i)=>[now-(335-i)*1800,1,2+Math.sin(i/9),4+Math.abs(Math.sin(i/11))*3,180+Math.sin(i/13)*40,3,1012+Math.sin(i/16)*2,22+Math.sin(i/8)*4,60+Math.sin(i/8)*12,20000,3,350,i%50===0?0.4:0,0,0,0,2.71,1,3]);
  const b=await chromium.launch({executablePath:process.env.CHROME||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const context=await b.newContext({viewport:{width:1440,height:960},deviceScaleFactor:1});
  await context.addInitScript(()=>{if(!localStorage.getItem('wd.settings'))localStorage.setItem('wd.settings',JSON.stringify({token:'demo-not-a-real-token',stationId:'1',deviceId:'1',stationName:'North Texas · DEMO DATA',units:'imperial',theme:'dark',palette:'oled',lat:32.75,lon:-97.33,deskRadar:false,nightDim:false,kioskCycleSec:0,eco:'off',nearbyRadius:0,notif:{enabled:false},motion:'lite'}));});
  await context.routeWebSocket('wss://ws.weatherflow.com/**',ws=>ws.onMessage(()=>ws.send(JSON.stringify({type:'rapid_wind',ob:[now,3.2,190]}))));
  await context.route('**/*',async route=>{
    const u=new URL(route.request().url());
    let body;
    if(u.hostname==='swd.weatherflow.com') {
      if(u.pathname.includes('better_forecast')) body=fc;
      else if(u.pathname.includes('observations/device')) body={obs};
      else if(u.pathname.includes('observations/stn')) body={obs:[{...fc.current_conditions,timestamp:now}]};
      else body={stations:[{station_id:1,name:'North Texas · DEMO DATA',latitude:32.75,longitude:-97.33,devices:[{device_id:1,device_type:'ST'}]}]};
    } else if(u.hostname==='api.weather.gov') body={features:[],properties:{periods:[]}};
    else if(u.hostname.includes('open-meteo.com')) body={hourly:{time:[]},daily:{time:[],precipitation_sum:[],sunshine_duration:[]}};
    else if(u.origin==='http://127.0.0.1:8094'&&u.pathname==='/history/tuples') body={obs};
    else if(u.origin==='http://127.0.0.1:8094'&&/^\/(config|health|diag|events|udp)/.test(u.pathname)) return route.fulfill({status:404,body:''});
    if(body!==undefined)return route.fulfill({json:body});
    return route.continue();
  });
  const p=await context.newPage();
  p.on('pageerror',e=>console.error(e.message));
  await p.goto('http://127.0.0.1:8094/#desk');
  await p.waitForTimeout(4000);
  fs.mkdirSync('shots/marketing',{recursive:true});
  for (const file of fs.readdirSync('shots/marketing')) {
    if (/^frame-\d{3}\.png$/.test(file)) fs.unlinkSync(`shots/marketing/${file}`);
  }
  for (const [name, palette] of [['oled','oled'],['blue',''],['light',''],['contrast','contrast'],['ember','ember']]) {
    await p.evaluate(({palette,name}) => {
      const s=JSON.parse(localStorage.getItem('wd.settings'));
      s.palette=palette; s.theme=name==='light'?'light':'dark';
      localStorage.setItem('wd.settings',JSON.stringify(s));
    }, {palette,name});
    await p.reload();
    await p.waitForTimeout(1200);
    await p.screenshot({path:`docs/stormdesk-theme-${name}.png`});
  }
  await p.evaluate(() => {
    const s=JSON.parse(localStorage.getItem('wd.settings'));
    s.palette='oled';s.theme='dark';localStorage.setItem('wd.settings',JSON.stringify(s));
  });
  await p.reload();await p.waitForTimeout(1200);
  await p.screenshot({path:'docs/stormdesk-dashboard.png'});
  await p.evaluate(() => document.querySelector('#desk').scrollTop=750);
  await p.waitForTimeout(200);
  await p.screenshot({path:'docs/stormdesk-outlook.png'});
  await p.evaluate(() => document.querySelector('#desk').scrollTop=0);
  let frame=0;
  const frames=async (count=5) => {
    for(let j=0;j<count;j++) await p.screenshot({path:`shots/marketing/frame-${String(frame++).padStart(3,'0')}.png`});
  };
  await frames();
  await p.locator('.tab[data-section="lab"]').click();
  await p.waitForTimeout(11000);
  await p.screenshot({path:'docs/stormdesk-radar.png'});await frames();
  await p.locator('.tab[data-section="data"]').click();
  await p.waitForTimeout(1600);
  await p.screenshot({path:'docs/stormdesk-data.png'});await frames();
  await p.locator('.tab[data-section="desk"]').click();
  await p.locator('#btn-settings').click();
  await p.locator('[data-settings-tab="appearance"]').click();
  await p.waitForTimeout(350);
  await p.screenshot({path:'docs/stormdesk-settings.png'});await frames(3);
  await p.locator('.settings-close').click();
  await p.setViewportSize({width:390,height:844});
  for(const [tab,name] of [['desk','dashboard'],['lab','radar']]) {
    await p.locator(`.tab[data-section="${tab}"]`).click();
    await p.waitForTimeout(tab==='lab'?3000:1200);
    await p.screenshot({path:`docs/stormdesk-${name}-mobile.png`});
  }
  await b.close();
})();
