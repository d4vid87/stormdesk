import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root=join(import.meta.dirname,'..');
const weather=(await readFile(join(root,'.github/ci/fixture.js'),'utf8')).split("addEventListener('load'")[0];
const seed=`<script>${weather}
window.fixtureForecast=fc;window.archiveErrors=[];window.archiveMutations=[];window.archiveRecoveries=[];window.archiveRequests=[];window.archiveViolations=[];window.archiveEvents=[];
addEventListener('wd:archive-change',()=>archiveEvents.push('change'));addEventListener('wd:refresh',()=>archiveEvents.push('refresh'));
addEventListener('error',e=>archiveErrors.push(e.message));addEventListener('unhandledrejection',e=>archiveErrors.push(String(e.reason)));
localStorage.setItem('wd.settings',JSON.stringify({stationSource:'ecowitt',stationId:'fixture-A',stationName:'Garden station',lat:52,lon:13,units:'imperial',deskRadar:false,eco:'off',motion:'off',places:[{id:'trip',name:'Trip station',lat:50,lon:8}]}));
localStorage.setItem('wd.setupComplete','1');
localStorage.setItem('wd.cache.forecast:ecowitt:fixture-A:52:13:imperial::auto',JSON.stringify(fc));
window.archiveNotes=[{id:1,ts:now-3600,until:now-3600,kind:'note',text:'<img src=x onerror="window.noteXss=true">',value:null}];
window.archiveRows=Array.from({length:18},(_,i)=>[now-5400+i*300,0,3,6,180,60,1010,i===2?120:20+i/10,60,0,2,100,i<5?.1:0,0,0,0,2.6,1,2,3]);
let nextNote=2;window.archiveDailyMissing=false;
window.fetch=async(input,init={})=>{
 const url=new URL(input,location.href);archiveRequests.push(url.href);
 const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
 if(url.pathname.endsWith('sites.json'))return reply([]);
 if(url.pathname==='/config'){
   if(init.method==='PUT')return reply({_rev:1,settings:JSON.parse(localStorage.getItem('wd.settings'))});
   return reply({},503);
 }
 if(url.pathname==='/history/review')return reply({obs:archiveRows,notes:archiveNotes,context:'fixture-context-A',from:+url.searchParams.get('from'),to:+url.searchParams.get('to')});
 if(url.pathname==='/history/tuples')return reply({obs:archiveRows.map(row=>row.slice(0,19))});
 if(url.pathname==='/history/daily')return reply(Array.from({length:8},(_,i)=>({day:new Date((now-i*86400)*1000).toISOString().slice(0,10),tempMin:12+i/10,tempMax:23+i/10,rain:archiveDailyMissing?null:i/2+(archiveNotes.some(n=>n.text==='Report invalidation check')?1:0),gustMax:8,strikes:0,battMin:2.6,readings:60,sampleMinutes:60})));
 if(url.pathname==='/history/channels')return reply([
   ...[2,1,0].map(i=>({ts:now-i*300,name:'soil_moisture_1',value:35+i,unit:'%'})),
   ...[2,1,0].map(i=>({ts:now-i*300,name:'greenhouse_temperature',value:20+i,unit:'°C'})),
   {ts:now,name:'battery_soil_1',value:1,unit:'low'}
 ]);
 if(url.pathname==='/archive/edit'||url.pathname==='/archive/recover'){
   const body=JSON.parse(init.body||'{}');
   if(init.method!=='POST'||body.context!=='fixture-context-A'){archiveViolations.push('Missing POST/context');return reply({error:'Station context mismatch'},409);}
   if(url.pathname==='/archive/recover'){
     if(window.failRecoveryAt&&archiveRecoveries.length>=window.failRecoveryAt)return reply({error:'Fixture provider unavailable'},503);
     archiveRecoveries.push(body);
     if(!(body.to>body.from&&body.to-body.from<=86400)){archiveViolations.push('Recovery window exceeded one day');return reply({error:'Range too large'},400);}
     return reply({ok:true,inserted:1});
   }
   archiveMutations.push(body);
   if(body.action==='note')archiveNotes.push({...body,id:nextNote++,until:body.until??body.ts});
   if(body.action==='delete-note')archiveNotes=archiveNotes.filter(n=>n.id!==body.id);
   if(body.action==='import'){
     const result={ok:true,inserted:body.rows.length,duplicates:0};
     if(window.holdImport)return new Promise(resolve=>{window.finishHeldImport=()=>resolve(reply(result));});
     return reply(result);
   }
   return reply({ok:true});
 }
 if(url.pathname==='/environment/air')return reply({DateTime:new Date().toISOString(),pm2_5_atm:10,pm2_5_atm_b:14});
 if(url.hostname==='api.water.noaa.gov'){
   const time=new Date((now-60)*1000).toISOString();
   if(url.pathname.endsWith('/stageflow'))return reply({observed:{primaryUnits:'ft',data:[{validTime:time,primary:4.2}]}});
   return reply({lid:'PTTP1',name:'Fixture River',status:{observed:{validTime:time,primary:4.2,primaryUnit:'ft'}},flood:{stageUnits:'ft',categories:{minor:{stage:10}}}});
 }
 if(url.hostname==='air-quality-api.open-meteo.com'&&url.searchParams.get('hourly')?.includes('pollen'))return reply({hourly:{time:[now,now+3600,now+7200],grass_pollen:[1,2,3],birch_pollen:[4,5,6]}});
 if(url.hostname==='api.open-meteo.com'&&url.searchParams.has('current'))return new Promise(()=>{});
 if(url.hostname==='api.weather.gov'&&url.pathname.includes('alerts'))return reply({features:[]});
 return reply({},503);
};</script>`;
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 try {
   if(path==='/camera.svg'){res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80"><rect width="240" height="80" fill="#246"/></svg>');return;}
   const file=path==='/fixtures/archive-workbench-check.js'?join(root,'scripts',path):join(root,'site',path==='/'?'index.html':path);
   let body=await readFile(file);
   if(path==='/')body=Buffer.from(body.toString().replace('</head>',seed+'</head>').replace('</body>','<script type="module" src="/fixtures/archive-workbench-check.js"></script></body>'));
   res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.svg')?'image/svg+xml':'text/html');res.end(body);
 }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const profile=await mkdtemp(join(tmpdir(),'stormdesk-archive-'));
try {
 await mkdir(join(root,'shots'),{recursive:true});
 for(const size of ['1280,900','412,915']){
   const browser=spawn(process.env.CHROME||'chromium',['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--user-data-dir='+join(profile,size),'--remote-debugging-port=0','about:blank']);
   let errors='',socket;const exceptions=[];
   browser.stderr.on('data',chunk=>{errors+=chunk;});
   const timer=setTimeout(()=>browser.kill(),60000),pause=()=>new Promise(resolve=>setTimeout(resolve,100));
   try {
     for(let i=0;i<100&&!errors.includes('DevTools listening on');i++)await pause();
     const endpoint=errors.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];assert.ok(endpoint,errors);
     const pages=await(await fetch('http://127.0.0.1:'+new URL(endpoint).port+'/json')).json();
     socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
     await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve);socket.addEventListener('error',reject);});
     let id=0;const pending=new Map();
     socket.addEventListener('message',event=>{const msg=JSON.parse(event.data);if(msg.method==='Runtime.exceptionThrown')exceptions.push(msg.params.exceptionDetails.exception?.description||msg.params.exceptionDetails.text);const task=pending.get(msg.id);if(task){pending.delete(msg.id);msg.error?task.reject(Error(JSON.stringify(msg.error))):task.resolve(msg.result);}});
     const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});socket.send(JSON.stringify({id:key,method,params}));});
     await send('Runtime.enable');
     const [width,height]=size.split(',').map(Number);await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
     await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/?full=1'});
     let status;
     for(let i=0;i<450;i++){status=(await send('Runtime.evaluate',{expression:'document.body?.dataset.archiveCheck',returnByValue:true})).result.value;if(status)break;await pause();}
     const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(root,'shots','archive-'+size.replace(',','x')+'.png'),Buffer.from(shot.data,'base64'));
     const details=(await send('Runtime.evaluate',{expression:'JSON.stringify({stage:window.archiveStage,errors:window.archiveErrors,violations:window.archiveViolations,camera:document.getElementById("local-camera")?.outerHTML,cameraBounds:document.getElementById("local-camera")?.getBoundingClientRect().toJSON(),cameraContentBounds:document.querySelector("#local-camera > div")?.getBoundingClientRect().toJSON()})',returnByValue:true})).result.value;
     assert.equal(status,'ok',size+': '+details);assert.deepEqual(exceptions,[],'No uncaught browser exceptions');
     await send('Emulation.setEmulatedMedia',{media:'print'});
     const printState=(await send('Runtime.evaluate',{expression:`(() => {
       document.body.classList.add('printing-archive');
       const visible = selector => { const node=document.querySelector(selector),style=getComputedStyle(node);return style.visibility==='visible'&&style.display!=='none'&&node.getBoundingClientRect().height>0; };
       return {report:visible('#archive-report'),summary:visible('#archive-report-summary'),table:visible('#archive-report table'),calendar:getComputedStyle(document.querySelector('.archive-calendar')).display};
     })()`,returnByValue:true})).result.value;
     assert.deepEqual(printState,{report:true,summary:true,table:true,calendar:'none'},size+': Printable report keeps summary and table, hides calendar');
     await send('Runtime.evaluate',{expression:"document.body.classList.remove('printing-archive')"});
     await send('Emulation.setEmulatedMedia',{media:'screen'});
   }finally{
     clearTimeout(timer);socket?.close();const closed=new Promise(resolve=>browser.once('close',resolve));if(browser.exitCode==null){browser.kill();await closed;}
   }
 }
 console.log('Archive UI: QC undo, notes/snow, safe text, CSV preview/import, bounded recovery, reports, sensor alerts and per-place weather sources passed at desktop/mobile sizes.');
}finally{server.close();await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
