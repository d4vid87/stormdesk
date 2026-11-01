import {settings,saveSettings,coords,everyVisible,refreshAll,windToMs} from './app.js';
import {pollen,river,localAir} from './weather-providers.js';
import {activityWindows} from './archive-tools.js';
import {chart} from './charts.js';

const el=(tag,text,parent)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;parent?.append(n);return n;};
const homeIdentity=()=>JSON.stringify(['stationSource','deviceId','stationId','wllHost','lacrosseEmail','ingestKey','awnApiKey','ecowittMac'].map(k=>settings()[k]||''));
const identity=()=>{const s=settings(),p=s.places.find(p=>p.id===s.activePlace);return JSON.stringify([homeIdentity(),coords(),s.activePlace,p?.forecastProvider||s.forecastProvider,s.units,s.windUnit]);};
const SOURCE_FIELDS=['pollenEnabled','riverGauge','purpleAirHost','cameraUrl','ecowittAppKey','ecowittApiKey','ecowittMac'];
const configuration=()=>{const s=settings(),p=s.places.find(p=>p.id===s.activePlace);return JSON.stringify([homeIdentity(),coords(),s.activePlace,p?.forecastProvider||s.forecastProvider,p?.alertRegion||s.alertRegion,...SOURCE_FIELDS.map(k=>s[k])]);};
function input(parent,label,key,type='text'){const l=el('label',label+' ',parent),n=el('input',null,l);n.type=type;n.value=settings()[key]??'';n.dataset.setting=key;return n;}
function select(parent,label,options,value){const l=el('label',label+' ',parent),s=el('select',null,l);for(const [v,t]of options){const o=el('option',t,s);o.value=v;}s.value=value;return s;}
function button(parent,text,fn){const b=el('button',text,parent);b.type='button';b.onclick=fn;return b;}
export function initEnvironmentDashboard(){
  if(document.getElementById('weather-extras'))return;
  const root=el('div',null,document.getElementById('desk'));root.id='weather-extras';root.className='grid';
  const panel=(id,title)=>{const d=el('details',null,root);d.id=id;d.className='card';el('summary',title,d);const content=el('div',null,d);content.style.padding='12px';return {d,content};};
  const pollenPanel=panel('local-pollen','Pollen forecast'),airPanel=panel('local-air','Local air quality'),riverPanel=panel('local-river','River conditions'),cameraPanel=panel('local-camera','Weather camera'),activityPanel=panel('activity-planner','Outdoor activity windows');
  const settingsPanel=el('details',null,document.getElementById('settings-tools')||document.getElementById('drawer'));settingsPanel.className='settings-group';el('summary','Weather sources, sensors & camera',settingsPanel);
  const sourceText=el('p','Provider and warning region apply to the currently selected place. Other inputs apply to your home station. Save below to apply.',settingsPanel);
  const s=settings(),p=s.places.find(p=>p.id===s.activePlace);
  const provider=select(settingsPanel,'Forecast provider',[['auto','Automatic'],['gfs','GFS'],['ecmwf','ECMWF'],['icon','ICON'],['gem','GEM']],p?.forecastProvider||s.forecastProvider||'auto');
  const region=select(settingsPanel,'Official warning source',[['US','United States · NWS'],['CA','Canada · ECCC']],p?.alertRegion||s.alertRegion||'US');
  const enabled=input(settingsPanel,'Enable pollen forecast','pollenEnabled','checkbox');enabled.checked=!!s.pollenEnabled;
  input(settingsPanel,'NOAA river gauge ID (for example PTTP1)','riverGauge');
  input(settingsPanel,'PurpleAir local IPv4 address','purpleAirHost');
  input(settingsPanel,'Weather camera snapshot URL','cameraUrl','url');
  input(settingsPanel,'Ecowitt application key','ecowittAppKey','password');input(settingsPanel,'Ecowitt API key','ecowittApiKey','password');input(settingsPanel,'Ecowitt MAC address','ecowittMac');
  const msg=el('p','',settingsPanel);msg.setAttribute('role','status');
  button(settingsPanel,'Save weather sources',()=>{try{
    const patch=Object.fromEntries([...settingsPanel.querySelectorAll('[data-setting]')].map(n=>[n.dataset.setting,n.type==='checkbox'?n.checked:n.value.trim()]));
    if(patch.cameraUrl){const u=new URL(patch.cameraUrl);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error('Use an HTTP(S) camera URL without embedded credentials.');}
    if(patch.riverGauge&&!/^[A-Za-z0-9]{3,8}$/.test(patch.riverGauge))throw Error('Enter a valid NOAA gauge identifier.');
    if(settings().activePlace)patch.places=settings().places.map(x=>x.id===settings().activePlace?{...x,forecastProvider:provider.value,alertRegion:region.value}:x);
    else Object.assign(patch,{forecastProvider:provider.value,alertRegion:region.value});
    saveSettings(patch);refreshAll();msg.textContent='Weather sources saved.';
  }catch(e){msg.textContent=e.message;}});
  let version=0;
  function schedule(name,part,seconds,fn){everyVisible(name,seconds,part.content,async()=>{if(!part.d.open||part.d.hidden)return;const key=configuration(),v=version;try{const data=await fn();if(key!==configuration()||v!==version||!part.d.open||part.d.hidden)return;data();}catch(e){if(key===configuration()&&v===version&&part.d.open&&!part.d.hidden)part.content.textContent=`Unavailable: ${e.message}`;}});}
  async function cameraSnapshot(){const url=settings().cameraUrl;return()=>{
    cameraPanel.content.replaceChildren();const img=el('img',null,cameraPanel.content);img.alt='Configured weather camera';img.style.maxWidth='100%';img.referrerPolicy='no-referrer';
    const caption=el('p','Loading snapshot…',cameraPanel.content);
    img.onload=()=>{caption.textContent=`Received ${new Date().toLocaleTimeString()}. Capture time is not provided by this image URL.`;};
    img.onerror=()=>{caption.textContent='Camera unavailable. Check its URL and browser access permissions.';};
    const snapshot=new URL(url);snapshot.searchParams.set('_stormdesk_snapshot',String(Date.now()));img.src=snapshot.href;
  };}
  function configure(){version++;
    pollenPanel.d.hidden=!settings().pollenEnabled;airPanel.d.hidden=!settings().purpleAirHost;riverPanel.d.hidden=!settings().riverGauge;cameraPanel.d.hidden=!settings().cameraUrl;
    for(const part of [pollenPanel,airPanel,riverPanel,cameraPanel])part.content.replaceChildren();
    schedule('extras-pollen',pollenPanel,3600,async()=>{const c=coords(),data=await pollen(c.lat,c.lon);return()=>{pollenPanel.content.replaceChildren();if(!data.available){el('p',data.reason,pollenPanel.content);return;}el('p','Open-Meteo / CAMS · grains/m³ · forecast, not a local measurement',pollenPanel.content);const canvas=el('canvas',null,pollenPanel.content);canvas.className='chart';chart(canvas,Object.entries(data.series).map(([name,points],i)=>({name,color:['#73b7ff','#f6bc65','#c68aff','#64d6ba','#f58d8d','#aaa'][i],data:points.map(p=>({x:p.time,y:p.value}))})),{label:'Pollen forecast',unit:' grains/m³'});};});
    schedule('extras-air',airPanel,120,async()=>{const data=await localAir();return()=>{airPanel.content.replaceChildren();el('p',data.available?`PM2.5: ${data.pm25.toFixed(1)} µg/m³`:'Local sensor unavailable or stale',airPanel.content);el('p',`${data.source} · ${data.observedAt||'Timestamp unavailable'}`,airPanel.content);el('p','Short-term particulate reading; not a regulatory daily AQI. Archived sensor readings are in History → Additional sensors.',airPanel.content);};});
    schedule('extras-river',riverPanel,900,async()=>{const data=await river(settings().riverGauge);return()=>{riverPanel.content.replaceChildren();el('h3',data.name,riverPanel.content);el('p',`${data.level??'Unavailable'} ${data.unit||''} · ${data.stale?'Stale · ':''}${data.validTime||'Timestamp unavailable'}`,riverPanel.content);for(const [name,value]of Object.entries(data.thresholds))el('p',`${name}: ${value??'Unavailable'} ${data.unit}`,riverPanel.content);const canvas=el('canvas',null,riverPanel.content);canvas.className='chart';chart(canvas,[{name:'Observed river level',color:'#73b7ff',data:data.history.map(p=>({x:p.time,y:p.value}))}],{label:'River observations',unit:data.unit});el('p',`Source: ${data.source}`,riverPanel.content);};});
    schedule('extras-camera',cameraPanel,60,cameraSnapshot);
  }
  const forecastStatus=el('p','',activityPanel.content),form=el('div',null,activityPanel.content),out=el('div',null,activityPanel.content);let forecast=null;
  const presets=select(form,'Activity',[['walk','Walking'],['cycle','Cycling'],['work','Outdoor work'],['custom','Custom']],settings().activity?.preset||'walk');
  const limits={};for(const [key,label,value]of [['minTemp','Minimum temperature (°C)',5],['maxTemp','Maximum temperature (°C)',28],['wind','Maximum wind (m/s)',8],['rain','Maximum rain chance (%)',20]]){limits[key]=input(form,label,key,'number');limits[key].value=settings().activity?.[key]??value;}
  const daylight=input(form,'Daylight only','activityDaylight','checkbox');daylight.checked=settings().activity?.daylight??true;
  presets.onchange=()=>{const values={walk:[5,28,8,20],cycle:[8,28,6,15],work:[3,30,10,20]}[presets.value];if(values)Object.values(limits).forEach((n,i)=>n.value=values[i]);};
  function renderActivity(){out.replaceChildren();if(!forecast){forecastStatus.textContent='Waiting for the forecast.';return;}forecastStatus.textContent=`${forecast._forecastSource||'Forecast'}${forecast._forecastFallback?' · '+forecast._forecastFallback:''}${forecast._cached?' · saved forecast':''}`;
    const chosen=Object.fromEntries(Object.entries(limits).map(([k,n])=>[k,Number(n.value)]));chosen.daylight=daylight.checked;
    if(!Object.values(chosen).every(v=>typeof v==='boolean'||Number.isFinite(v))||chosen.minTemp>chosen.maxTemp||chosen.wind<0||chosen.rain<0||chosen.rain>100){el('p','Check the activity limits.',out);return;}
    const hours=(forecast.forecast?.hourly||[]).filter(h=>h.time*1000>=Date.now()).map(h=>{const d=(forecast.forecast.daily||[]).find(d=>h.time>=d.day_start_local&&h.time<d.day_start_local+86400);return{time:h.time*1000,temp:Number.isFinite(h.air_temperature)?settings().units==='metric'?h.air_temperature:(h.air_temperature-32)*5/9:null,wind:Number.isFinite(h.wind_avg)?windToMs(h.wind_avg):null,rain:h.precip_probability,daylight:!!d&&Number.isFinite(d.sunrise)&&Number.isFinite(d.sunset)&&h.time>=d.sunrise&&h.time<d.sunset};});
    const windows=activityWindows(hours,chosen);if(!windows.length)el('p','No complete forecast window meets these limits.',out);for(const w of windows.slice(0,12))el('p',`${new Date(w.start).toLocaleString()} – ${new Date(w.end).toLocaleString()}`,out);
    el('p',`Windows meet all selected temperature, wind, rain-chance${chosen.daylight?' and daylight':''} limits. Missing values do not qualify. Official warnings still apply.`,out);
  }
  button(form,'Find and save windows',()=>{saveSettings({activity:{preset:presets.value,...Object.fromEntries(Object.entries(limits).map(([k,n])=>[k,Number(n.value)])),daylight:daylight.checked}});renderActivity();});
  let configKey=configuration(),forecastKey=identity(),homeKey=homeIdentity(),placeKey=settings().activePlace;
  let savedControls=Object.fromEntries(SOURCE_FIELDS.map(k=>[k,settings()[k]]));
  let savedProvider=provider.value,savedRegion=region.value;
  window.addEventListener('wd:forecast',e=>{forecast=e.detail;forecastKey=identity();renderActivity();});
  window.addEventListener('wd:settings',()=>{
    const current=configuration(),nextForecast=identity();
    if(nextForecast!==forecastKey){forecastKey=nextForecast;forecast=null;renderActivity();}
    if(current!==configKey){
      const s=settings(),reset=homeIdentity()!==homeKey,p=s.places.find(p=>p.id===s.activePlace),changedPlace=placeKey!==s.activePlace;
      for(const n of settingsPanel.querySelectorAll('[data-setting]')){
        const k=n.dataset.setting;
        if(reset||savedControls[k]!==s[k]){if(n.type==='checkbox')n.checked=!!s[k];else n.value=s[k]??'';}
      }
      const nextProvider=p?.forecastProvider||s.forecastProvider||'auto',nextRegion=p?.alertRegion||s.alertRegion||'US';
      if(reset||changedPlace||savedProvider!==nextProvider)provider.value=nextProvider;
      if(reset||changedPlace||savedRegion!==nextRegion)region.value=nextRegion;
      savedProvider=nextProvider;savedRegion=nextRegion;savedControls=Object.fromEntries(SOURCE_FIELDS.map(k=>[k,s[k]]));
      configKey=current;homeKey=homeIdentity();placeKey=s.activePlace;msg.textContent='';configure();
    }
  });
  cameraPanel.d.addEventListener('toggle',()=>{if(cameraPanel.d.open){schedule('extras-camera',cameraPanel,60,cameraSnapshot);}else{const img=cameraPanel.content.querySelector('img');if(img){img.onload=null;img.onerror=null;img.removeAttribute('src');}cameraPanel.content.replaceChildren();}});
  const style=el('style',null,root);style.textContent='#weather-extras{margin:16px 0} #weather-extras summary{padding:12px;cursor:pointer;font-weight:600} #weather-extras input,#weather-extras select,#weather-extras button{min-height:44px;margin:6px;max-width:100%}';
  configure();
}
