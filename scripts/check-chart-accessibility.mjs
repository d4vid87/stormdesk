import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const page = `<!doctype html><html><meta charset="utf-8"><body><canvas id="chart" style="width:600px;height:200px"></canvas>
<script type="module">
import { chart } from '/charts.js';
const canvas = document.getElementById('chart');
const check = (yes, label) => { if (!yes) throw Error(label); };
const key = name => canvas.dispatchEvent(new KeyboardEvent('keydown', {key:name,bubbles:true}));
try {
 const data = Array.from({length:205}, (_,i)=>({x:1700000000000+i*60000,sourceX:1600000000000+i*60000,y:i}));
 const series = [{name:'Measured',color:'#123',data}, {name:'Spread',type:'band',color:'#789',data:[{x:data[0].x,lo:2,hi:8}]}];
 let picked;
 const opts = {label:'Temperature',unit:'C',hoverFormat:x=>String(x),onPick:(p,name)=>picked={p,name}};
 chart(canvas,series,opts);
 const access = canvas._wdAccessible;
 check(canvas.tabIndex===0 && canvas.getAttribute('aria-describedby')===access.live.id,'focus/readout wiring');
 check(access.table.rows.length===0,'table must be lazy');
 canvas.focus(); key('ArrowRight'); key('Enter');
 check(picked.p===data[0] && picked.name==='Measured','keyboard original point callback');
 check(access.live.textContent.includes(String(data[0].sourceX)),'original observation time spoken');
 key('End'); key('Enter'); check(picked.p===data[204],'End selects last');
 key('ArrowLeft'); key('Enter'); check(picked.p===data[203],'Left selects previous');
 key('ArrowDown'); check(access.live.textContent.includes('Spread') && access.live.textContent.includes('2.0 to 8.0'),'band bounds spoken');
 key('ArrowUp'); key('Home'); key('Enter'); check(picked.p===data[0],'Up/Home return first series');
 access.details.open=true; await new Promise(resolve=>setTimeout(resolve,20));
 check(access.table.tBodies[0].rows.length===100,'100-row page cap');
 const first=access.table.tBodies[0].rows[0], rows=access.rows;
 chart(canvas,series,opts);
 check(access.table.tBodies[0].rows[0]===first && access.rows===rows,'redraw preserves DOM and index');
 access.next.click(); check(access.page.textContent==='Readings 101–200 of 206','next page');
 access.next.click(); check(access.table.tBodies[0].rows.length===6 && access.next.disabled,'last page bounded');
 const band=access.table.tBodies[0].rows[5]; check(band.cells[3].textContent==='2.0 C' && band.cells[4].textContent==='8.0 C','band table values');
 access.previous.click(); check(access.page.textContent==='Readings 101–200 of 206','previous page');
 let newer=0; chart(canvas,series,{...opts,onPick:()=>newer++}); key('Home'); key('Enter'); check(newer===1,'latest callback');
 chart(canvas,[],opts); key('Enter');
 check(canvas.getAttribute('aria-label')==='Temperature: no data','empty aria label');
 check(access.live.textContent==='No chart data available.' && access.table.tBodies[0].rows.length===0,'empty clears table and readout');
 check(canvas._wdKeyX==null && access.next.disabled && access.previous.disabled,'empty clears selection and paging');
 document.body.dataset.result='ok';
} catch(error) { document.body.dataset.result=error.stack; }
</script></body></html>`;
const server = createServer(async (req,res)=>{
  try {
    if(req.url==='/charts.js') {res.setHeader('Content-Type','text/javascript'); res.end(await readFile(join(root,'site/js/charts.js')));}
    else {res.setHeader('Content-Type','text/html');res.end(page);}
  } catch {res.writeHead(500).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const profile=await mkdtemp(join(tmpdir(),'stormdesk-chart-'));
const browser=spawn(process.env.CHROME||'chromium',['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--user-data-dir='+profile,'--remote-debugging-port=0','about:blank']);
let errors='',socket;
browser.stderr.on('data',chunk=>{errors+=chunk;});
const timer=setTimeout(()=>browser.kill(),30000);
const pause=()=>new Promise(resolve=>setTimeout(resolve,100));
try {
  for(let i=0;i<100&&!errors.includes('DevTools listening on');i++) await pause();
  const endpoint=errors.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];
  assert.ok(endpoint,errors);
  const pages=await(await fetch('http://127.0.0.1:'+new URL(endpoint).port+'/json')).json();
  socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve);socket.addEventListener('error',reject);});
  let id=0;const pending=new Map();
  socket.addEventListener('message',event=>{const msg=JSON.parse(event.data),task=pending.get(msg.id);if(task){pending.delete(msg.id);msg.error?task.reject(Error(JSON.stringify(msg.error))):task.resolve(msg.result);}});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});socket.send(JSON.stringify({id:key,method,params}));});
  await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port});
  let result;
  for(let i=0;i<100;i++){result=(await send('Runtime.evaluate',{expression:'document.body?.dataset.result',returnByValue:true})).result.value;if(result)break;await pause();}
  assert.equal(result,'ok');
  console.log('Chart accessibility: keyboard navigation, original timestamps/callbacks, spoken bands, lazy bounded tables, redraw reuse and empty states passed.');
} finally {
  clearTimeout(timer);socket?.close();server.close();
  const closed=new Promise(resolve=>browser.once('close',resolve));
  if(browser.exitCode==null){browser.kill();await closed;}
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
