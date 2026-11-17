#!/usr/bin/env python3
"""Serve an isolated, explicitly labeled demo of the real app for captures.
The source app is never seeded; this temporary copy owns its own browser origin.
"""
from pathlib import Path
from tempfile import TemporaryDirectory
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import json
import os
import re
import shutil
import sys
root=Path(__file__).resolve().parents[1]
with TemporaryDirectory(prefix='stormdesk-preview-') as temp:
    target=Path(temp)
    shutil.copytree(root/'site',target,dirs_exist_ok=True)
    shutil.copy(root/'scripts/fixtures/hookecho-kfws-20260926.png',target/'recorded-radar.png')
    boot=(target/'js/boot.js').read_text().replace('function stillUrl() {',"function stillUrl() { return '/recorded-radar.png';")
    boot=boot.replace('Still image · 5 min · tap for the live map','Recorded HookEcho · Sep 26, 2026 · demo capture').replace('Radar snapshot · refreshes every 5 minutes','Recorded HookEcho · Sep 26, 2026 · demo capture')
    if scene_file := os.environ.get('STORMDESK_CAPTURE_RADAR_SCENE'):
        scene_url=Path(scene_file).read_text().strip()
        if not re.fullmatch(r'https://app\.hookecho\.io/#scene=[A-Za-z0-9_%-]+',scene_url):
            raise ValueError('Capture radar scene must be an https://app.hookecho.io/#scene= URL')
        boot=boot.replace('export function radarUrl(zoom, embed = true) {',
            'export function radarUrl(zoom, embed = true) { return '+json.dumps(scene_url)+';',1)
    (target/'js/boot.js').write_text(boot)
    fixture=(root/'.github/ci/fixture.js').read_text().split("addEventListener('load'")[0]
    fixture+=r'''
const offset = -Number(new Intl.DateTimeFormat('en-US', {timeZone:'America/Chicago',timeZoneName:'shortOffset'}).formatToParts(new Date(now*1000)).find(p=>p.type==='timeZoneName').value.match(/GMT([+-]\d+)/)?.[1] || 0) * 3600;
const shift = Math.floor((now-offset)/86400)*86400+offset-day;
fc.forecast.daily.forEach(d => {
 const futureOffset = -Number(new Intl.DateTimeFormat('en-US', {timeZone:'America/Chicago',timeZoneName:'shortOffset'}).formatToParts(new Date((d.day_start_local+shift)*1000)).find(p=>p.type==='timeZoneName').value.match(/GMT([+-]\d+)/)?.[1] || 0)*3600;
 const delta = shift+futureOffset-offset;
 d.day_start_local+=delta; d.sunrise+=delta; d.sunset+=delta;
});
const captureDays = fc.forecast.daily.map(d=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(new Date(d.day_start_local*1000)));
console.assert(new Set(captureDays).size===captureDays.length, 'Capture forecast dates must stay distinct across daylight saving changes');
fc.current_conditions.sea_level_pressure=29.95;
fc._provenance='DEMO DATA · illustrative station readings';
const demoDays = [
 ['Partly Cloudy','partly-cloudy-day',76,57,10,0], ['Sunny','clear-day',79,58,0,0],
 ['Cloudy','cloudy',73,60,20,0], ['Rain','rainy',68,56,75,.32],
 ['Thunderstorms','thunderstorm',71,59,85,.58], ['Partly Cloudy','partly-cloudy-day',72,54,15,0],
 ['Sunny','clear-day',75,53,0,0], ['Sunny','clear-day',77,55,5,0],
 ['Rain','rainy',69,57,65,.21], ['Cloudy','cloudy',70,55,20,0],
];
fc.forecast.daily.forEach((d,i)=>{
 const [conditions,icon,air_temp_high,air_temp_low,precip_probability,precip_accum]=demoDays[i];
 Object.assign(d,{conditions,icon,air_temp_high,air_temp_low,precip_probability,precip_accum});
});
const localHour=t=>Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'numeric',hourCycle:'h23'}).format(new Date(t*1000)));
fc.forecast.hourly.forEach((h,i)=>{
 h.time=Math.floor(now/3600)*3600+i*3600;
 const d=fc.forecast.daily.findLast(d=>d.day_start_local<=h.time)||fc.forecast.daily[0], hour=localHour(h.time);
 const daylight=hour>=7&&hour<18, warmth=(1+Math.cos((hour-15)*Math.PI/12))/2;
 Object.assign(h,{air_temperature:+(d.air_temp_low+(d.air_temp_high-d.air_temp_low)*warmth).toFixed(1),
  conditions:!daylight&&d.icon==='clear-day'?'Clear':d.conditions,icon:daylight?d.icon:d.icon.replace('-day','-night'),
  precip_probability:d.precip_probability,precip:d.precip_accum&&hour>=10&&hour<18?+(d.precip_accum/8).toFixed(3):0,
  precip_source:'DEMO DATA · illustrative hourly forecast',visibility:16093,
  relative_humidity:Math.round(77-warmth*26),cloud_cover:d.icon==='clear-day'?8:d.icon==='partly-cloudy-day'?38:86,
  uv:daylight?Math.max(0,5-Math.abs(hour-12)):0,sea_level_pressure:29.95});
 h.feels_like=h.air_temperature;
});
const currentHour=fc.forecast.hourly[0];
Object.assign(fc.current_conditions,{...currentHour,time:now,dew_point:54,precip_accum_local_day:0,
 solar_radiation:currentHour.uv*105,brightness:currentHour.uv*8400});
console.assert(fc.forecast.daily.length===10&&new Set(demoDays.map(d=>d[0])).size===5,'Demo has ten varied forecast days');
console.assert(fc.forecast.hourly.every((h,i)=>h.time%3600===0&&(!i||h.time-fc.forecast.hourly[i-1].time===3600)),'Demo forecast uses consecutive whole hours');
const iso=t=>new Date(t*1000).toISOString();
const demoPolygon={type:'Polygon',coordinates:[[[-100,30],[-94,30],[-94,35],[-100,35],[-100,30]]]};
const outlook=(dayIndex,properties,geometry=demoPolygon)=>({type:'FeatureCollection',_provenance:'DEMO DATA · illustrative outlook',features:[{type:'Feature',geometry,properties:{
 issue_time:iso(now),start_time:iso(day+dayIndex*86400),end_time:iso(day+(dayIndex+1)*86400),
 ISSUE:iso(now),VALID:iso(day+dayIndex*86400),EXPIRE:iso(day+(dayIndex+1)*86400),...properties}}]});
function modelDemo(u){
 const numeric=u.searchParams.get('timeformat')==='unixtime', times=fc.forecast.hourly.map(h=>numeric?h.time:iso(h.time));
 const hourly={time:times};
 const values={us_aqi:32,pm2_5:5,ozone:40,visibility:16093,freezing_level_height:3600,soil_temperature_6cm:65.8,soil_temperature_18cm:66.4,soil_moisture_3_to_9cm:.26,soil_moisture_9_to_27cm:.29};
 const mapping={temperature_2m:'air_temperature',apparent_temperature:'feels_like',precipitation:'precip',precipitation_probability:'precip_probability',cloud_cover:'cloud_cover',wind_speed_10m:'wind_avg'};
 for(const key of (u.searchParams.get('hourly')||'').split(',').filter(Boolean)){
  const series=fc.forecast.hourly.map(h=>mapping[key]?h[mapping[key]]:key==='wet_bulb_temperature_2m'?h.air_temperature-6:values[key]??0);
  hourly[key]=series;
  for(const model of (u.searchParams.get('models')||'').split(',').filter(Boolean))hourly[`${key}_${model}`]=series;
 }
 const daily={time:fc.forecast.daily.map(d=>numeric?d.day_start_local:iso(d.day_start_local).slice(0,10)),
  precipitation_sum:fc.forecast.daily.map(d=>d.precip_accum),sunshine_duration:demoDays.map(d=>d[1]==='clear-day'?28800:18000),et0_fao_evapotranspiration:demoDays.map(()=>2.2)};
 const quarter=Math.floor(now/900)*900;
 console.assert(Object.values(hourly).every(a=>a.length===times.length),'Demo model arrays align with their hourly timestamps');
 return {_provenance:'DEMO DATA · illustrative model estimates',hourly,daily,current:{temperature_2m:currentHour.air_temperature,dew_point_2m:54},
  hourly_units:{soil_temperature_6cm:'°F',soil_temperature_18cm:'°F',soil_moisture_3_to_9cm:'m³/m³',soil_moisture_9_to_27cm:'m³/m³'},
  minutely_15:{time:Array.from({length:48},(_,i)=>iso(quarter+i*900)),precipitation:Array(48).fill(0),precipitation_probability:Array(48).fill(10)}};
}
const observations=Array.from({length:336},(_,i)=>{
 const time=now-(335-i)*1800,hour=localHour(time),warmth=(1+Math.cos((hour-15)*Math.PI/12))/2,uv=Math.max(0,5-Math.abs(hour-12));
 return [time,1,2+Math.sin(i/9),4+Math.abs(Math.sin(i/11))*3,180+Math.sin(i/13)*40,3,1012+Math.sin(i/16)*2,
  (57+19*warmth-32)/1.8,77-warmth*26,uv*8400,uv,uv*105,0,0,0,0,2.71,1,3];
});
const captureTheme=new URLSearchParams(location.search).get('theme');
const prior=JSON.parse(localStorage.getItem('wd.settings')||'{}');
const selectedTheme=captureTheme||prior.palette||'graphite';
localStorage.setItem('wd.settings',JSON.stringify({token:'demo-not-a-real-token',stationId:'1',deviceId:'1',stationName:'Fort Worth · DEMO DATA',lat:32.75,lon:-97.33,units:'imperial',theme:['light','solarized-light','contrast-light'].includes(selectedTheme)?'light':selectedTheme==='auto'?'auto':'dark',palette:['blue','light','auto'].includes(selectedTheme)?'':selectedTheme.replace(/-light$/,''),deskRadar:new URLSearchParams(location.search).get('view')==='radar',eco:'off',motion:new URLSearchParams(location.search).get('motion')||'auto',nightDim:false,kioskCycleSec:0,nearbyRadius:0,speakAlerts:false,webNotif:false}));
const realFetch=window.fetch.bind(window);
window.fetch=async (input,options)=>{
 const u=new URL(typeof input==='string'?input:input.url,location.href);
 let body;
 if(u.hostname==='swd.weatherflow.com'){
  if(u.pathname.includes('better_forecast'))body=fc;
  else if(u.pathname.includes('observations/device'))body={obs:observations};
  else if(u.pathname.includes('observations/stn'))body={obs:[{...fc.current_conditions,timestamp:now}]};
  else body={stations:[{station_id:1,name:'Fort Worth · DEMO DATA',latitude:32.75,longitude:-97.33,devices:[{device_id:1,device_type:'ST'}]}]};
 }else if(u.hostname==='api.weather.gov')body={_provenance:'DEMO DATA · no illustrative alerts',features:[],properties:{cwa:'FWD',periods:[],observationStations:'https://api.weather.gov/gridpoints/FWD/80,100/stations'}};
 else if(u.hostname.includes('open-meteo.com'))body=modelDemo(u);
 else if(u.hostname==='mapservices.weather.noaa.gov'){
  if(u.pathname.includes('wpc_wssi'))body={_provenance:'DEMO DATA · no illustrative winter impact',features:[]};
  else if(u.pathname.includes('NWS_HeatRisk'))body={_provenance:'DEMO DATA · illustrative HeatRisk',samples:fc.forecast.daily.slice(0,7).map(d=>({value:0,attributes:{idp_validtime:d.day_start_local*1000,idp_filedate:now*1000}}))};
  else body=outlook(Number(u.pathname.match(/\/(\d+)\/query$/)?.[1]||0),{dn:0,outlook:'DEMO DATA'});
 }else if(u.hostname==='www.spc.noaa.gov')body=outlook(Number(u.pathname.match(/day(\d)/)?.[1]||1)-1,{LABEL:u.pathname.includes('_cat')?'TSTM':'.05',DEMO_DATA:true},{type:'Polygon',coordinates:[[[-88,30],[-82,30],[-82,35],[-88,35],[-88,30]]]});
 else if(u.hostname==='api.met.no')body={properties:{moonrise:{time:new Date((day+shift+19*3600)*1000).toISOString()},moonset:{time:new Date((day+shift+7*3600)*1000).toISOString()}}};
 else if(u.origin===location.origin&&u.pathname==='/history/tuples')body={obs:observations};
 else if(u.origin===location.origin&&u.pathname==='/udp')body={device_status:{voltage:2.77,rssi:-62,hub_rssi:-48,uptime:864000,sensor_status:0,_at:now}};
 else if(u.origin===location.origin&&/^\/(config|health|diag|events|history)/.test(u.pathname))return new Response('',{status:404});
 if(body===fc){
  const {crossing}=await import('./js/env.js');
  fc.forecast.daily.forEach(d=>{
   d.sunrise=Math.floor((crossing(new Date(d.sunrise*1000),32.75,-97.33,-0.833,true)?.getTime()||d.sunrise*1000)/1000);
   d.sunset=Math.floor((crossing(new Date(d.sunset*1000),32.75,-97.33,-0.833,false)?.getTime()||d.sunset*1000)/1000);
  });
 }
 return body===undefined?realFetch(input,options):new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
};
window.WebSocket=class extends EventTarget {constructor(){super();this.readyState=0;}close(){}send(){}};
window.EventSource=class extends EventTarget {close(){}};
addEventListener('load',()=>{document.body.dataset.capture='demo';});
'''
    (target/'capture-demo.js').write_text(fixture)
    html=(target/'index.html').read_text().replace('<head>','<head><script src="capture-demo.js"></script>',1)
    (target/'index.html').write_text(html)
    lite=target/'lite/index.html'
    lite.write_text(lite.read_text().replace('<head>','<head><script src="/capture-demo.js"></script>',1))
    shutil.copy(root/'.github/ci/fixture.js',target/'ci-fixture.js')
    (target/'selftest.html').write_text(html.replace('</body>','<script type="module" src="ci-fixture.js"></script></body>'))
    port=int(sys.argv[1]) if len(sys.argv)>1 else 8094
    print(f'Demo capture server: http://127.0.0.1:{port}',flush=True)
    ThreadingHTTPServer(('127.0.0.1',port),partial(SimpleHTTPRequestHandler,directory=temp)).serve_forever()
