import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const weather = (await readFile(join(root, '.github/ci/fixture.js'), 'utf8')).split("addEventListener('load'")[0];
const seed = `<script>${weather}
fc.current_conditions.wind_gust = 150;
fc.forecast.daily[0].air_temp_low = 0;
fc.forecast.hourly[0].conditions = 'Snow';
window.fixtureForecast = fc;
localStorage.setItem('wd.settings', JSON.stringify({stationSource:'ecowitt',stationName:'Test station',lat:32.75,lon:-97.33,units:'imperial',deskRadar:false,eco:'off',motion:'off'}));
localStorage.setItem('wd.setupComplete', '1');
localStorage.setItem('wd.cache.forecast:ecowitt::32.75:-97.33:imperial::auto:["","","","",""]',JSON.stringify(fc));
window.requests = [];
window.fetch = async (input) => {
  const url = new URL(input, location.href); requests.push(url.href);
  const reply = j => new Response(JSON.stringify(j), {headers:{'Content-Type':'application/json'}});
  if(url.pathname.endsWith('sites.json')) return reply([]);
  if(url.pathname === '/history/tuples') {
    if(window.failHistory && +url.searchParams.get('to') < now - 180*86400) return new Response('{}',{status:503});
    const end = +(url.searchParams.get('to') || now), start = +(url.searchParams.get('from') || end-10800);
    return reply({obs:Array.from({length:12},(_,i)=>[start+(end-start)*i/12,0,3,6,180,60,1010,20+i,60,0,2,100,.1,0,0,0,2.6,1,2])});
  }
  if(url.hostname === 'api.open-meteo.com' && url.searchParams.has('current')) return new Promise(()=>{});
  if(url.hostname === 'ensemble-api.open-meteo.com') return reply({hourly:{time:[new Date(now*1000).toISOString()],temperature_2m_member01:[70],temperature_2m_member02:[74]}});
  if(url.hostname === 'api.open-meteo.com' && url.searchParams.has('models')) return reply({hourly:{time:[new Date((day+3600)*1000).toISOString()],temperature_2m_gfs_seamless:[70],temperature_2m_ecmwf_ifs025:[78]}});
  return new Response('{}', {status:503});
};</script>`;
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  try {
    const file = path === '/fixtures/weather-check.js' ? join(root, 'scripts', path) : join(root, 'site', path === '/' ? 'index.html' : path);
    let body = await readFile(file);
    if(path === '/') body = Buffer.from(body.toString().replace('</head>',seed+'</head>').replace('</body>','<script type="module" src="/fixtures/weather-check.js"></script></body>'));
    res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.svg')?'image/svg+xml':'text/html');
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const profile = await mkdtemp(join(tmpdir(),'stormdesk-weather-'));
try {
  await mkdir(join(root,'shots'),{recursive:true});
  for(const size of ['1280,900','412,915']) {
    const browser = spawn(process.env.CHROME || 'chromium', ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
      '--user-data-dir='+join(profile,size),'--remote-debugging-port=0','about:blank']);
    let errors = '', socket;
    browser.stderr.on('data', chunk => { errors += chunk; });
    const timer = setTimeout(() => browser.kill(), 30000);
    const pause = () => new Promise(resolve => setTimeout(resolve, 100));
    try {
      for (let i=0; i<100 && !errors.includes('DevTools listening on'); i++) await pause();
      const endpoint = errors.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];
      assert.ok(endpoint, errors);
      const port = new URL(endpoint).port;
      const pages = await (await fetch('http://127.0.0.1:'+port+'/json')).json();
      socket = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
      await new Promise((resolve,reject) => { socket.addEventListener('open',resolve); socket.addEventListener('error',reject); });
      let id=0; const pending=new Map();
      socket.addEventListener('message', event => {
        const message=JSON.parse(event.data), task=pending.get(message.id);
        if(task) { pending.delete(message.id); message.error ? task.reject(Error(JSON.stringify(message.error))) : task.resolve(message.result); }
      });
      const send=(method,params={})=>new Promise((resolve,reject)=>{
        const key=++id; pending.set(key,{resolve,reject}); socket.send(JSON.stringify({id:key,method,params}));
      });
      const [width,height]=size.split(',').map(Number);
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/?full=1'});
      let status;
      for(let i=0;i<150;i++) {
        const result=await send('Runtime.evaluate',{expression:'document.body?.dataset.weatherCheck',returnByValue:true});
        status=result.result.value;
        if(status) break;
        await pause();
      }
      const shot=await send('Page.captureScreenshot',{format:'png'});
      await writeFile(join(root,'shots','weather-'+size.replace(',','x')+'.png'),Buffer.from(shot.data,'base64'));
      assert.equal(status,'ok');
    } finally {
      clearTimeout(timer); socket?.close();
      const closed = new Promise(resolve => browser.once('close', resolve));
      if (browser.exitCode == null) { browser.kill(); await closed; }
    }
  }
  console.log('Weather UI: saved boot, lazy analysis, reading sources, model coverage, history comparisons and warning radar actions passed at desktop/mobile sizes.');
} finally { server.close(); await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100}); }
