// Archive calculations use SI and UTC epoch seconds. No display-unit values enter storage.
export const fields = ['ts','wind_lull','wind_avg','wind_gust','wind_dir','wind_interval','pressure','temp','humidity','lux','uv','solar','rain','precip_type','strike_dist','strikes','battery','report_interval','day_rain'];
const finite = Number.isFinite;
export function usable(rows, notes) { return rows.filter(r => !notes.some(n => n.kind === 'exclude' && r[0] >= n.ts && r[0] <= n.until)); }
export function quality(rows) {
  const issues = [], limits = { 2:[0,150],3:[0,150],6:[300,1200],7:[-90,65],8:[0,100],10:[0,30],12:[0,1000] };
  const names = {2:'Wind',3:'Gust',6:'Pressure',7:'Temperature',8:'Humidity',10:'UV',12:'Rain'};
  for (const [key, [lo,hi]] of Object.entries(limits)) {
    const k=Number(key); let prev=null, start=null, count=0;
    for (const r of rows) {
      const v=r[k]; if (!finite(v)) { prev=null;start=null;count=0;continue; }
      if(v<lo||v>hi) issues.push({ts:r[0],until:r[0],text:`${names[k]} outside plausible range (${v})`});
      if(prev && r[0]-prev[0]<=600 && k===7 && Math.abs(v-prev[k])>12) issues.push({ts:r[0],until:r[0],text:'Temperature changed over 12°C within ten minutes; inspect the sensor'});
      if(prev && v===prev[k] && r[0]-prev[0]<=600) { start ??= prev[0]; count++; }
      else { start=null;count=0; }
      if([6,7].includes(k) && start!=null && r[0]-start>=21600 && count>=24) {
        issues.push({ts:start,until:r[0],text:`${names[k]} unchanged for six hours; possible stuck sensor`}); start=r[0];count=0;
      }
      prev=r;
    }
  }
  // Compare daily temperature medians with preceding days: only a review prompt, never automatic rejection.
  const daily=new Map();
  for(const r of rows) if(finite(r[7])) { const d=Math.floor(r[0]/86400); if(!daily.has(d))daily.set(d,[]);daily.get(d).push(r[7]); }
  const med=[...daily].map(([d,v])=>[d,v.sort((a,b)=>a-b)[Math.floor(v.length/2)],v.length]);
  for(let i=3;i<med.length;i++) if(med.slice(i-3,i+1).every(d=>d[2]>=24)&&med[i][0]-med[i-3][0]===3) {
    const shifts=med.slice(i-2,i+1).map((d,j)=>d[1]-med[i-3+j][1]);
    if(shifts.every(v=>v>3)||shifts.every(v=>v<-3)) issues.push({ts:med[i-3][0]*86400,until:(med[i][0]+1)*86400-1,text:'Sustained temperature shift over three days; compare with weather conditions before excluding'});
  }
  return issues.slice(0,200);
}
export function gaps(rows, from, to, interval=60) {
  const result=[]; let last=from;
  for(const r of rows) { const expected=Math.max(interval,finite(r[17])?r[17]*60:interval); if(r[0]-last>expected*3)result.push({from:last,to:r[0],minutes:Math.round((r[0]-last)/60)}); last=r[0]; }
  if(to-last>interval*3)result.push({from:last,to,minutes:Math.round((to-last)/60)});
  return result;
}
export function storms(rows) {
  const events=[];let event=null,lastWet=null;
  for(const r of rows) {
    if(finite(r[12])&&r[12]>0) {
      if(lastWet==null||r[0]-lastWet>=21600) { event={start:r[0],end:r[0],rain:0,gust:null,strikes:0,peak:null};events.push(event); }
      lastWet=r[0];event.end=r[0];event.rain+=r[12];
      if(finite(r[17])&&r[17]>0)event.peak=Math.max(event.peak??0,r[12]*60/r[17]);
    }
    if(event&&r[0]-lastWet<21600) { if(finite(r[3]))event.gust=Math.max(event.gust??0,r[3]);if(finite(r[15]))event.strikes+=r[15]; }
  }
  return events.reverse();
}
export function parseCSV(text, units='si', timezone='UTC') {
  if(text.length>4*1024*1024)throw Error('CSV is larger than 4 MB; split the file first.');
  const records=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++) { const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(!quoted&&(c===','||c==='\n'||c==='\r')){row.push(cell);cell='';if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(v=>v.trim()))records.push(row);row=[];}}else cell+=c; }
  if(quoted)throw Error('Unclosed quoted CSV field.');row.push(cell);if(row.some(v=>v.trim()))records.push(row);
  if(records.length<2||records.length>10001)throw Error('Choose a CSV containing 1–10,000 data rows.');
  const aliases={time:'ts',timestamp:'ts',dateTime:'ts',outTemp:'temp',outHumidity:'humidity',windSpeed:'wind_avg',windGust:'wind_gust',windDir:'wind_dir',UV:'uv',radiation:'solar',interval:'report_interval'};
  const header=records.shift().map(x=>x.trim().replace(/^\uFEFF/,'')).map(x=>aliases[x]||x);
  if(!header.includes('ts'))throw Error('CSV requires ts, timestamp or dateTime (epoch seconds or ISO time).');
  if(new Set(header).size!==header.length)throw Error('Duplicate column names.');
  if(!fields.some(k=>k!=='ts'&&header.includes(k)))throw Error('No recognized weather columns.');
  if(!['si','us','weewx-metric'].includes(units))throw Error('Choose source units.');
  const seen=new Set();let duplicates=0;
  const rows=records.map((rec,index)=>{
    if(rec.length!==header.length)throw Error(`Row ${index+2}: column count differs from header.`);
    const r=fields.map(k=>{const s=rec[header.indexOf(k)]?.trim();if(!s)return null;if(k==='ts'&&!/^\d+(\.0+)?$/.test(s)){if(!/(Z|[+-]\d\d:\d\d)$/.test(s)&&timezone!=='UTC')throw Error(`Row ${index+2}: supply ISO timestamps with a UTC offset.`);return Date.parse(/(Z|[+-]\d\d:\d\d)$/.test(s)?s:s+'Z')/1000;}const v=Number(s);if(!finite(v))throw Error(`Row ${index+2}: invalid ${k}.`);return v;});
    if(!Number.isInteger(r[0])||r[0]<0||r[0]>Date.now()/1000+600)throw Error(`Row ${index+2}: invalid timestamp.`);
    if(units==='us'){if(r[7]!=null)r[7]=(r[7]-32)*5/9;if(r[6]!=null)r[6]*=33.8639;for(const i of [1,2,3])if(r[i]!=null)r[i]*=0.44704;for(const i of [12,18])if(r[i]!=null)r[i]*=25.4;}
    if(units==='weewx-metric'){for(const i of [1,2,3])if(r[i]!=null)r[i]/=3.6;for(const i of [12,18])if(r[i]!=null)r[i]*=10;}
    if(seen.has(r[0]))duplicates++;seen.add(r[0]);return r;
  }).sort((a,b)=>a[0]-b[0]);
  return {rows,duplicates,from:rows[0][0],to:rows.at(-1)[0],ignored:header.filter(h=>!fields.includes(h))};
}
export function activityWindows(hours, limits) {
  const windows=[];let active=null;
  for(const h of hours) {
    const ok=[h.time,h.temp,h.wind,h.rain].every(finite)&&h.temp>=limits.minTemp&&h.temp<=limits.maxTemp&&h.wind<=limits.wind&&h.rain<=limits.rain&&(!limits.daylight||h.daylight===true);
    if(!ok){active=null;continue;}if(!active||h.time>active.end){active={start:h.time,end:h.time};windows.push(active);}active.end=h.time+3600000;
  }
  return windows;
}
