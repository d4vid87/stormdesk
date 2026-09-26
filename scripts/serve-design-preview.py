#!/usr/bin/env python3
"""Serve an isolated, explicitly labeled demo of the real app for captures.
The source app is never seeded; this temporary copy owns its own browser origin.
"""
from pathlib import Path
from tempfile import TemporaryDirectory
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import shutil
import sys
root=Path(__file__).resolve().parents[1]
with TemporaryDirectory(prefix='stormdesk-preview-') as temp:
    target=Path(temp)
    shutil.copytree(root/'site',target,dirs_exist_ok=True)
    shutil.copy(root/'scripts/fixtures/hookecho-kfws-20260926.png',target/'recorded-radar.png')
    boot=(target/'js/boot.js').read_text().replace('function stillUrl() {',"function stillUrl() { return '/recorded-radar.png';")
    boot=boot.replace('Still image · 5 min · tap for the live map','Recorded HookEcho · Sep 26, 2026 · demo capture').replace('Radar snapshot · refreshes every 5 minutes','Recorded HookEcho · Sep 26, 2026 · demo capture')
    (target/'js/boot.js').write_text(boot)
    fixture=(root/'.github/ci/fixture.js').read_text().split("addEventListener('load'")[0]
    fixture+=r'''
const shift = 5 * 3600;
fc.forecast.daily.forEach(d => { d.day_start_local+=shift; d.sunrise+=shift; d.sunset+=shift; });
fc.current_conditions.sea_level_pressure=29.95;
fc._provenance='DEMO DATA · illustrative station readings';
const observations=Array.from({length:336},(_,i)=>[now-(335-i)*1800,1,2+Math.sin(i/9),4+Math.abs(Math.sin(i/11))*3,180+Math.sin(i/13)*40,3,1012+Math.sin(i/16)*2,22+Math.sin(i/8)*4,60+Math.sin(i/8)*12,20000,3,350,i%50===0?0.4:0,0,0,0,2.71,1,3]);
const captureTheme=new URLSearchParams(location.search).get('theme');
const prior=JSON.parse(localStorage.getItem('wd.settings')||'{}');
localStorage.setItem('wd.settings',JSON.stringify({...prior,token:'demo-not-a-real-token',stationId:'1',deviceId:'1',stationName:'Fort Worth · DEMO DATA',lat:32.75,lon:-97.33,units:'imperial',theme:'dark',palette:captureTheme||prior.palette||'graphite',deskRadar:true,eco:'off',motion:new URLSearchParams(location.search).get('motion')||'off',nightDim:false,kioskCycleSec:0,nearbyRadius:0,speakAlerts:false,webNotif:false}));
const realFetch=window.fetch.bind(window);
window.fetch=async (input,options)=>{
 const u=new URL(typeof input==='string'?input:input.url,location.href);
 let body;
 if(u.hostname==='swd.weatherflow.com'){
  if(u.pathname.includes('better_forecast'))body=fc;
  else if(u.pathname.includes('observations/device'))body={obs:observations};
  else if(u.pathname.includes('observations/stn'))body={obs:[{...fc.current_conditions,timestamp:now}]};
  else body={stations:[{station_id:1,name:'Fort Worth · DEMO DATA',latitude:32.75,longitude:-97.33,devices:[{device_id:1,device_type:'ST'}]}]};
 }else if(u.hostname==='api.weather.gov')body={features:[],properties:{periods:[]}};
 else if(u.hostname.includes('open-meteo.com'))body={minutely_15:{time:[],precipitation:[],precipitation_probability:[]},hourly:{time:[new Date().toISOString().slice(0,13)+':00'],us_aqi:[32],pm2_5:[5],ozone:[40]},daily:{time:[],precipitation_sum:[],sunshine_duration:[]}};
 else if(u.hostname==='api.met.no')body={properties:{moonrise:{time:new Date((day+shift+19*3600)*1000).toISOString()},moonset:{time:new Date((day+shift+7*3600)*1000).toISOString()}}};
 else if(u.origin===location.origin&&u.pathname==='/history/tuples')body={obs:observations};
 else if(u.origin===location.origin&&u.pathname==='/udp')body={device_status:{voltage:2.77,rssi:-62,hub_rssi:-48,uptime:864000,sensor_status:0,_at:now}};
 else if(u.origin===location.origin&&/^\/(config|health|diag|events|history)/.test(u.pathname))return new Response('',{status:404});
 return body===undefined?realFetch(input,options):new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
};
window.WebSocket=class extends EventTarget {constructor(){super();this.readyState=0;}close(){}send(){}};
window.EventSource=class extends EventTarget {close(){}};
addEventListener('load',()=>{document.body.dataset.capture='demo';});
'''
    (target/'capture-demo.js').write_text(fixture)
    html=(target/'index.html').read_text().replace('<head>','<head><script src="capture-demo.js"></script>',1)
    (target/'index.html').write_text(html)
    shutil.copy(root/'.github/ci/fixture.js',target/'ci-fixture.js')
    (target/'selftest.html').write_text(html.replace('</body>','<script type="module" src="ci-fixture.js"></script></body>'))
    port=int(sys.argv[1]) if len(sys.argv)>1 else 8094
    print(f'Demo capture server: http://127.0.0.1:{port}',flush=True)
    ThreadingHTTPServer(('127.0.0.1',port),partial(SimpleHTTPRequestHandler,directory=temp)).serve_forever()
