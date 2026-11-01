import { settings, refreshAll, U } from './app.js';
import { openDetail } from './detail.js';
import { toDisplay } from './almanac.js';
import { quality, usable, gaps, storms, parseCSV } from './archive-tools.js';

const el=(tag,text,parent)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;parent?.append(n);return n;};
const fmt=t=>new Date(t*1000).toLocaleString();
const station=()=>JSON.stringify(['stationSource','deviceId','stationId','wllHost','lacrosseEmail','ingestKey','awnApiKey','ecowittMac'].map(k=>settings()[k]||''));
async function request(path, body) {
  const r=await fetch(`${window.__WD_SRV||''}${path}`,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});
  const j=await r.json().catch(()=>({error:r.status===401?'Pair this screen as an editor to review or edit the archive.':`Request failed (${r.status})`}));
  if(!r.ok||j.error)throw Error(j.error||`Request failed (${r.status})`);return j;
}
function table(parent,headers,rows) { const wrap=el('div',null,parent);wrap.style.overflowX='auto';const t=el('table',null,wrap);t.style.width='100%';const head=el('tr',null,el('thead',null,t));headers.forEach(x=>el('th',x,head));const body=el('tbody',null,t);rows.forEach(row=>{const tr=el('tr',null,body);row.forEach(x=>{const td=el('td',null,tr);if(x instanceof Node)td.append(x);else td.textContent=x??'Unavailable';});});return t; }
function button(parent,text,fn){const b=el('button',text,parent);b.type='button';b.onclick=fn;return b;}
function field(parent,label,type,value){const l=el('label',label+' ',parent),i=el('input',null,l);i.type=type;i.value=value;return i;}
export function initArchiveWorkbench(){
  if(document.getElementById('archive-workbench'))return;
  const root=el('details',null,document.getElementById('data'));root.id='archive-workbench';root.className='card';
  el('summary','Archive review, notes & reports',root);
  const controls=el('div',null,root), now=new Date();
  const date=field(controls,'Period ending','date',new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10));
  const days=field(controls,'Days (1–7)','number','7');days.min=1;days.max=7;
  const status=el('p','Open to load this station’s archive. Calculations and CSV imports use SI units.',root);status.setAttribute('role','status');
  const body=el('div',null,root);let snapshot=null,context=station(),version=0;
  const update=async()=>{const seq=++version;context=station();body.replaceChildren();snapshot=null;status.textContent='Loading archive…';try{
    const n=Number(days.value),end=new Date(date.value+'T23:59:59').getTime()/1000;
    if(!Number.isInteger(n)||n<1||n>7||!Number.isFinite(end))throw Error('Choose a date and 1–7 days.');
    const data=await request(`/history/review?from=${end-n*86400+1}&to=${Math.min(end,Math.floor(Date.now()/1000))}`);
    if(seq!==version||station()!==context)return;snapshot=data;status.textContent=`${data.obs.length.toLocaleString()} raw readings. Exclusions affect charts and records; originals remain available here.`;render(data);
  }catch(e){if(seq===version)status.textContent=e.message;}};
  function archiveChanged(key, refresh=true){
    window.dispatchEvent(new CustomEvent('wd:archive-change',{detail:{station:key}}));
    if(key!==station())return;
    reportVersion++;reportLoaded=false;report.replaceChildren();
    if(refresh){refreshAll();if(annual.open)loadReport();}
  }
  const edit=async(action)=>{
    if(!snapshot||station()!==context)throw Error('Station changed; reload before editing.');
    const key=station();await request('/archive/edit',{...action,context:snapshot.context});
    archiveChanged(key);if(key===station())await update();
  };
  const run=fn=>async()=>{const key=station(),seq=version;try{await fn();}catch(e){if(key===station()&&seq===version)status.textContent=e.message;}};
  button(controls,'Load period',update);root.addEventListener('toggle',()=>{if(root.open&&!snapshot)update();});
  window.addEventListener('wd:settings',()=>{if(station()!==context){version++;context=station();snapshot=null;body.replaceChildren();reportVersion++;reportLoaded=false;report.replaceChildren();status.textContent='Station changed. Open or reload to view this station’s archive.';if(root.open)update();if(annual.open)loadReport();}});
  function section(title){const d=el('details',null,body);el('summary',title,d);return d;}
  function render(data){
    const rows=usable(data.obs,data.notes),q=section('Review sensor quality');
    el('p','These checks suggest periods to investigate. Real weather can produce large changes; exclusion requires your review and can be undone.',q);
    const findings=quality(data.obs);if(!findings.length)el('p','No suspicious patterns detected in this period. This is not a sensor calibration certificate.',q);
    for(const f of findings){const p=el('p',`${fmt(f.ts)} — ${f.text} `,q);const reason=el('input',null,p);reason.placeholder='Reason for excluding';reason.setAttribute('aria-label','Reason for excluding this period');button(p,'Exclude period',run(async()=>{if(!reason.value.trim())throw Error('Enter your reason before excluding this period.');await edit({action:'note',kind:'exclude',...f,text:reason.value});}));}
    const notes=section('Maintenance notes & manual snow');
    const noteTime=field(notes,'Observation time','datetime-local',date.value+'T12:00');
    const kind=el('select',null,notes);kind.setAttribute('aria-label','Entry type');[['note','Maintenance note'],['snowfall','New snowfall'],['snowdepth','Snow depth']].forEach(([v,t])=>{const o=el('option',t,kind);o.value=v;});
    const value=field(notes,'Snow amount (mm)','number','0');value.min=0;value.max=20000;value.step='any';
    const text=field(notes,'Note','text','');text.maxLength=2000;
    button(notes,'Save entry',run(()=>edit({action:'note',kind:kind.value,ts:Math.floor(new Date(noteTime.value).getTime()/1000),text:text.value,value:Number(value.value)})));
    table(notes,['Time','Type','Note / amount','Action'],data.notes.map(n=>[fmt(n.ts),n.kind,n.text+(n.value!=null?` · ${n.value} mm`:''),button(null,n.kind==='exclude'?'Restore readings':'Delete entry',run(()=>edit({action:'delete-note',id:n.id})))]));
    const gap=section('Missing periods & recovery');const missing=gaps(data.obs,data.from,Math.min(data.to,Date.now()/1000));
    el('p','Gaps exceed three expected report intervals. Recovery uses the configured station’s cloud credentials and preserves existing observations.',gap);
    table(gap,['From','To','Minutes'],missing.slice(0,100).map(g=>[fmt(g.from),fmt(g.to),g.minutes]));if(!missing.length)el('p','No gaps detected in this period.',gap);
    const recover=button(gap,'Recover selected period',run(async()=>{
      if(recover.disabled)return;
      const key=station(),seq=version;let inserted=0,completed=0;
      const from=Math.floor(data.from),to=Math.min(Math.floor(data.to),Math.floor(Date.now()/1000));
      if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from||to-from>7*86400)throw Error('Choose a past period of at most seven days.');
      recover.disabled=true;
      try {
        for(let cursor=from;cursor<to;){
          if(key!==station()||seq!==version)return;
          const end=Math.min(cursor+86400,to);
          status.textContent=`Recovering day ${completed+1}… ${inserted} readings added so far.`;
          const result=await request('/archive/recover',{from:cursor,to:end,context:data.context});
          inserted+=Number.isInteger(result.inserted)?result.inserted:0;completed++;cursor=end;
          archiveChanged(key,false);
        }
        if(key!==station()||seq!==version)return;
        refreshAll();if(annual.open)loadReport();await update();if(key===station())status.textContent=`Recovered ${inserted} readings across ${completed} requests. Existing observations were retained.`;
      }catch(e){
        if(key!==station()||seq!==version)return;
        if(completed){refreshAll();if(annual.open)loadReport();await update();}
        if(key===station())status.textContent=`Recovery stopped after ${completed} requests; ${inserted} readings added. ${e.message}`;
      }finally{recover.disabled=false;}
    }));
    const event=section('Rain events');el('p','A new event starts after six hours without recorded rain. Events touching the selected period’s edge may be incomplete. Peak intensity is an interval average.',event);
    table(event,['Start','Last rain','Rain (mm)','Peak (mm/h)','Gust (m/s)','Strikes'],storms(rows).map(s=>[fmt(s.start),fmt(s.end),s.rain.toFixed(2),s.peak?.toFixed(2),s.gust?.toFixed(1),s.strikes]));
    const heat=section('Hourly temperature heatmap');
    el('p','Mean observed temperature by local hour. Missing or excluded readings stay blank. Repeated clock hours during daylight saving changes share a cell.',heat);
    const buckets=new Map(),dayKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    for(const r of rows)if(Number.isFinite(r[0])&&Number.isFinite(r[7])){
      const d=new Date(r[0]*1000),key=`${dayKey(d)}:${d.getHours()}`,v=buckets.get(key)||[0,0];v[0]+=r[7];v[1]++;buckets.set(key,v);
    }
    const dates=[],last=new Date(data.to*1000),first=new Date(data.from*1000);first.setHours(0,0,0,0);
    for(let d=new Date(first);d<=last&&dates.length<8;d.setDate(d.getDate()+1))dates.push(dayKey(d));
    const heatRows=dates.map(day=>[day,...Array.from({length:24},(_,hour)=>{
      const value=buckets.get(`${day}:${hour}`),mean=value?value[0]/value[1]:null;
      const cell=el('span',mean==null?'—':mean.toFixed(1));
      cell.setAttribute('aria-label',`${day} ${String(hour).padStart(2,'0')}:00: ${mean==null?'No observations':mean.toFixed(1)+' degrees Celsius; '+value[1]+' observations'}`);
      cell.title=cell.getAttribute('aria-label');
      if(mean!=null)cell.style.cssText=`display:block;padding:6px;border-bottom:4px solid hsl(${Math.max(0,Math.min(240,180-mean*4))} 65% 50%)`;
      return cell;
    })]);
    const heatTable=table(heat,['Day / °C',...Array.from({length:24},(_,h)=>String(h).padStart(2,'0'))],heatRows);
    heatTable.querySelectorAll('th').forEach(th=>th.scope='col');
    renderImport(section('Import CSV history'));
  }
  function renderImport(parent){
    el('p','Accepts StormDesk CSV and named WeeWX columns. Timestamps must be epoch seconds or ISO dates. Existing timestamps are retained. Import at most 10,000 rows per file.',parent);
    const file=field(parent,'CSV file','file','');file.accept='.csv,text/csv';
    const units=el('select',null,parent);units.setAttribute('aria-label','CSV source units');[['si','SI: °C, m/s, hPa, mm'],['us','US: °F, mph, inHg, inches'],['weewx-metric','WeeWX metric: °C, km/h, hPa, cm']].forEach(([v,t])=>{const o=el('option',t,units);o.value=v;});
    const zone=el('select',null,parent);zone.setAttribute('aria-label','CSV time zone');[['explicit','Require an explicit ISO UTC offset'],['UTC','Interpret offset-free dates as UTC']].forEach(([v,t])=>{const o=el('option',t,zone);o.value=v;});
    const preview=el('p','',parent);let pending=null,previewVersion=0;
    const boundStation=station(),boundVersion=version,boundContext=snapshot.context;
    const current=()=>parent.isConnected&&station()===boundStation&&version===boundVersion&&snapshot?.context===boundContext;
    const commit=button(parent,'Import previewed rows',run(async()=>{
      if(!current())throw Error('Station changed; reload before importing.');
      if(!pending||commit.disabled)throw Error('Preview the file first.');
      const selected=pending,seq=previewVersion;pending=null;commit.disabled=true;
      try{
        const result=await request('/archive/edit',{action:'import',rows:selected.rows,context:boundContext});
        archiveChanged(boundStation);
        if(!current()||seq!==previewVersion)return;
        await update();
        if(station()===boundStation)status.textContent=`Imported ${result.inserted}; retained ${result.duplicates} existing timestamps.`;
      }catch(e){if(current()&&seq===previewVersion){pending=selected;commit.disabled=false;throw e;}}
    }));commit.disabled=true;
    const clear=()=>{previewVersion++;pending=null;commit.disabled=true;preview.textContent='';};
    file.onchange=clear;units.onchange=clear;zone.onchange=clear;
    button(parent,'Preview import',run(async()=>{
      clear();if(!current())throw Error('Station changed; reload before importing.');
      const selected=file.files[0],sourceUnits=units.value,sourceZone=zone.value,seq=previewVersion;
      if(!selected)throw Error('Choose a CSV file.');
      try{
        const candidate=await selected.text();
        if(!current()||seq!==previewVersion||file.files[0]!==selected||units.value!==sourceUnits||zone.value!==sourceZone)return;
        pending=parseCSV(candidate,sourceUnits,sourceZone);
        preview.textContent=`${pending.rows.length} rows · ${fmt(pending.from)} to ${fmt(pending.to)} · ${pending.duplicates} duplicate timestamps within file. Ignored columns: ${pending.ignored.join(', ')||'none'}.`;commit.disabled=false;
      }catch(e){if(current()&&seq===previewVersion)throw e;}
    }));
  }
  const annual=el('details',null,root);el('summary','Seasonal calendar & printable reports',annual);
  const year=field(annual,'Year','number',String(now.getFullYear()));year.min=1900;year.max=now.getFullYear();
  const month=field(annual,'Month (0 for whole year)','number','0');month.min=0;month.max=12;
  const report=el('div',null,annual);report.id='archive-report';let reportLoaded=false,reportVersion=0;
  const loadReport=async()=>{
    const identity=station(),seq=++reportVersion;reportLoaded=false;report.replaceChildren();
    try{
      const y=Number(year.value),m=Number(month.value);
      if(!Number.isInteger(y)||y<1900||y>new Date().getFullYear()||!Number.isInteger(m)||m<0||m>12)throw Error('Choose a valid year and month.');
      const data=await request(`/history/daily?tz=${-new Date().getTimezoneOffset()}`);
      if(identity!==station()||seq!==reportVersion)return;
      const dayKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const start=new Date(y,m?m-1:0,1),end=new Date(y,m?m:12,1),today=new Date();
      today.setHours(0,0,0,0);
      const dates=[];for(let day=new Date(start);day<end&&day<=today;day.setDate(day.getDate()+1))dates.push(dayKey(day));
      const wanted=new Set(dates),byDay=new Map(data.filter(d=>wanted.has(d.day)).map(d=>[d.day,d]));
      const selected=dates.flatMap(day=>byDay.has(day)?[byDay.get(day)]:[]);
      const values=key=>selected.map(d=>d[key]).filter(Number.isFinite);
      const aggregate=(key,fn)=>{const v=values(key);return v.length?fn(v):null;};
      const sum=v=>v.reduce((a,b)=>a+b,0);
      const totals=toDisplay({tempMin:aggregate('tempMin',v=>Math.min(...v)),tempMax:aggregate('tempMax',v=>Math.max(...v)),gustMax:aggregate('gustMax',v=>Math.max(...v)),rain:aggregate('rain',sum)});
      el('h2',`${settings().stationName||'Station'} · ${y}${m?'-'+String(m).padStart(2,'0'):''}`,report);
      const summary=el('div',null,report);summary.id='archive-report-summary';summary.className='kv-rows';
      const display=(value,unit,digits=1)=>Number.isFinite(value)?value.toFixed(digits)+' '+unit:'Unavailable';
      for(const [label,value]of [
        ['Observed low',display(totals.tempMin,U.temp())],
        ['Observed high',display(totals.tempMax,U.temp())],
        ['Recorded rain',display(totals.rain,U.precip(),2)],
        ['Peak gust',display(totals.gustMax,U.wind())],
      ]){const line=el('div',null,summary);el('span',label,line);el('span',value,line);}
      const readings=values('readings'),minutes=values('sampleMinutes');
      el('p',`${selected.length} of ${dates.length} elapsed calendar days have observations${dates.length?' ('+(selected.length/dates.length*100).toFixed(1)+'% day coverage)':''}; ${dates.length-selected.length} days have no observations.`,report);
      el('p',`Readings: ${selected.length&&readings.length===selected.length?sum(readings).toLocaleString():'Unavailable'}. Reported sampling minutes: ${selected.length&&minutes.length===selected.length?sum(minutes).toLocaleString():'Unavailable'}. Day coverage does not imply complete days; reported intervals can overlap.`,report);
      el('p',`Totals use available observations. Rain is reported on ${values('rain').length} days. Missing values are not zero; excluded periods are omitted, and partial days can understate rainfall. Future dates are not included.`,report);
      const grid=el('div',null,report);grid.className='archive-calendar';grid.style.cssText='display:grid;grid-template-columns:repeat(auto-fill,minmax(95px,1fr));gap:6px';
      for(const day of dates){
        const d=byDay.get(day);
        if(!d){const cell=el('div',day+'\nNo observations',grid);cell.className='archive-calendar-missing';cell.style.cssText='white-space:pre-line;padding:6px;border:1px dashed var(--line);font-size:13px';continue;}
        const value=toDisplay(d),b=button(grid,`${day}\n${value.tempMax?.toFixed(1)??'—'}° / ${value.tempMin?.toFixed(1)??'—'}°\n${value.rain?.toFixed(2)??'—'} ${U.precip()}`,()=>openDetail('temp',new Date(day+'T12:00:00').getTime()));
        b.style.whiteSpace='pre-line';if(Number.isFinite(d.rain))b.style.borderBottom=`${Math.min(12,2+d.rain/5)}px solid var(--accent,#64b5f6)`;
      }
      table(report,['Date','Low (°C)','High (°C)','Rain (mm)','Gust (m/s)','Strikes','Readings','Sampled minutes'],selected.map(d=>[d.day,d.tempMin,d.tempMax,d.rain,d.gustMax,d.strikes,d.readings,d.sampleMinutes]));reportLoaded=true;
    }catch(e){if(identity===station()&&seq===reportVersion)status.textContent=e.message;}
  };
  for(const control of [year,month])control.addEventListener('input',()=>{reportVersion++;reportLoaded=false;report.replaceChildren();});
  button(annual,'Load calendar / report',loadReport);button(annual,'Print / save PDF',()=>{if(!reportLoaded){status.textContent='Load a report first.';return;}document.body.classList.add('printing-archive');window.print();document.body.classList.remove('printing-archive');});
  annual.addEventListener('toggle',()=>{if(annual.open&&!reportLoaded)loadReport();});
  const style=el('style',null,root);style.textContent='@media print {body.printing-archive * {visibility:hidden} body.printing-archive #archive-report,body.printing-archive #archive-report * {visibility:visible} body.printing-archive #archive-report {position:absolute;left:0;top:0;width:100%;color:black;background:white} body.printing-archive #archive-report button, body.printing-archive #archive-report .archive-calendar {display:none!important}} #archive-workbench{padding:16px;margin:16px 0} #archive-workbench details{padding:12px 0} #archive-workbench summary{cursor:pointer;font-weight:600} #archive-workbench input,#archive-workbench select,#archive-workbench button{margin:6px;min-height:44px;max-width:100%} #archive-workbench td,#archive-workbench th{padding:6px;text-align:left}';
}
