import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../site/js/forecast-desk.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const c = vm.createContext({ Date, timeStr: () => '' });
vm.runInContext(source, c);
const original = {current_conditions:{visibility:0},forecast:{daily:[{day_start_local:0},{day_start_local:86400}],hourly:[{time:3600,cloud_cover:0},{time:7200}]}};
const model = {current_conditions:{visibility:10000,cloud_cover:80},forecast:{daily:[{day_start_local:86400,precip_accum:0.3}],hourly:[{time:7200,cloud_cover:75},{time:3600,cloud_cover:90}]}};
const combined = c.withForecastContext(original, model);
assert.equal(combined.current_conditions.visibility,0,'Primary zero readings win over supplementary estimates');
assert.equal(combined.current_conditions.cloud_cover,80);
assert.equal(combined.forecast.hourly[0].cloud_cover,0);
assert.equal(combined.forecast.hourly[1].cloud_cover,75,'Hours match by timestamp, not array index');
assert.equal(combined.forecast.daily[0].precip_accum,undefined);
assert.equal(combined.forecast.daily[1].precip_accum,0.3);
assert.equal(original.forecast.hourly[1].cloud_cover,undefined,'Context never mutates the primary station feed');
assert.equal(c.withForecastContext(null,model),null);
const now = 18000;
const fc = { forecast: {
  daily: [0, 90000, 176400, 262800].map(day_start_local => ({ day_start_local })),
  hourly: Array.from({length:80}, (_,i) => ({time:i*3600,precip_probability:0})),
} };
assert.equal(c.forecastHours(fc, false, 8, now).length, 8);
assert.equal(c.forecastHours(fc, false, 4, now).length, 4);
assert.equal(c.forecastHours(fc, true, 8, now)[0].time, 90000, 'Tomorrow uses provider midnight across a 25-hour day');
fc.forecast.daily[2].day_start_local = 172800;
assert.ok(c.forecastHours(fc, true, 8, now).every(h => h.time < 172800), '23-hour day stops at the next provider boundary');

assert.equal(c.forecastHours(fc, true, 8, 9999999).length, 0, 'Expired forecast does not recycle a previous day');
assert.equal(c.forecastHours({}, false, 8, now).length, 0);
assert.equal(c.precipitationOutlook(fc, now).low, true);
fc.forecast.hourly[6].precip_probability = null;
assert.equal(c.precipitationOutlook(fc, now).low, false, 'Missing probability is not a dry forecast');
fc.forecast.hourly[8].precip_probability = 70;
assert.equal(c.precipitationOutlook(fc, now).next.time, 28800);
assert.equal(c.precipitationOutlook({}, now).low, false);

const api = readFileSync(new URL('../site/js/api.js', import.meta.url), 'utf8');
let units = 'imperial';
const provider = vm.createContext({ Date, settings:()=>({units}), omIcon:(code, day)=>day?'day':'night', omWords:()=>'', overlayStation:()=>{} });
vm.runInContext(api.slice(api.indexOf('export function shapeOm'), api.indexOf('// The station\'s reading')).replace('export ', ''), provider);
const payload = { current:{time:1000,temperature_2m:68,dew_point_2m:50}, hourly:{time:[1000],apparent_temperature:[67],cloud_cover:[85],freezing_level_height:[3000],precipitation:[0],is_day:[0]}, daily:{time:[0],precipitation_sum:[0.28],wind_speed_10m_max:[12]} };
const normalized = provider.shapeOm(payload);
assert.equal(normalized.current_conditions.cloud_base_estimate,1250);
assert.equal(normalized.current_conditions.freezing_level,3000, 'Altitude stays in metres until displayed');
assert.equal(normalized.forecast.hourly[0].icon,'night');
assert.equal(normalized.forecast.hourly[0].feels_like,67);
assert.equal(normalized.forecast.daily[0].precip_accum,0.28);
assert.equal(normalized.forecast.daily[0].wind_avg,12);
assert.equal(provider.shapeOm({}).current_conditions.cloud_base_estimate,null);
const feet = structuredClone(payload);
feet.hourly_units = {visibility:'ft',freezing_level_height:'ft'};
feet.hourly.visibility = [32808.4]; feet.hourly.freezing_level_height = [9842.52];
const converted = provider.shapeOm(feet);
assert.ok(Math.abs(converted.current_conditions.visibility - 10000) < 0.01, 'Provider feet normalize before distance display');
assert.ok(Math.abs(converted.current_conditions.freezing_level - 3000) < 0.01);
assert.ok(Math.abs(converted.forecast.hourly[0].freezing_level - 3000) < 0.01);
units='metric'; payload.current.temperature_2m=20; payload.current.dew_point_2m=10;
assert.equal(provider.shapeOm(payload).current_conditions.cloud_base_estimate,1250);
const pro = readFileSync(new URL('../site/js/pro.js', import.meta.url), 'utf8');
assert.ok(pro.includes("if ($('hero-normal')?.getClientRects().length) renderNormal(d)"), 'Hidden legacy climate text cannot trigger a 30-year archive fetch');
let identity = 'A', finish;
const events = [];
const qpfContext = vm.createContext({coords:()=>({lat:32.75}),cacheContext:()=>identity,
  api:{dailyPrecip:()=>new Promise(resolve=>{finish=resolve;}),shapeOm:j=>j},
  window:{dispatchEvent:e=>events.push(e)},CustomEvent:class {constructor(type,options){this.type=type;this.detail=options.detail;}}});
vm.runInContext('let qpf = null;\n' + pro.slice(pro.indexOf('async function loadQpf()'),pro.indexOf('export function renderPro')),qpfContext);
const old = qpfContext.loadQpf(); identity='B'; finish({daily:{precipitation_sum:[1]}}); await old;
assert.equal(events.length,0,'An old-place model request cannot update the new forecast');
const fresh = qpfContext.loadQpf(); finish({daily:{precipitation_sum:[0.2]}}); await fresh;
assert.equal(events[0].detail.context,'B');
const timelineForecast = {forecast:{daily:[0,86400,172800].map(day_start_local=>({day_start_local})),
  hourly:Array.from({length:48},(_,i)=>({time:(i+1)*3600,precip:0.1,precip_period:'preceding-hour',visibility:10000}))}};
const timeline = c.hourlyWeather(timelineForecast, false, 0);
assert.equal(timeline.rows.length,24);
assert.ok(Math.abs(timeline.total-2.4)<0.0001,'Total uses all hours, never only the 3-hour samples');
assert.equal(timeline.rows[0].time,3600,'Preceding-hour amounts start after the forecast window boundary');
assert.equal(timeline.rows[23].time,86400,'Includes the hour ending at the final boundary');
timelineForecast.forecast.hourly[3].visibility = 500;
timelineForecast.forecast.hourly[4].visibility = 800;
assert.equal(c.hourlyWeather(timelineForecast,false,0).recovery.time,21600);
timelineForecast.forecast.hourly[4].visibility = null;
assert.equal(c.hourlyWeather(timelineForecast,false,0).recovery,null,'Missing visibility cannot imply clearance');
timelineForecast.forecast.hourly[2].precip = null;
const partial = c.hourlyWeather(timelineForecast,false,0);
assert.equal(partial.total,null,'Unknown rainfall is never zero');
assert.equal(partial.rows[3].accumulated,null,'Running totals stop after missing data');
timelineForecast.forecast.hourly[2].precip = 0;
timelineForecast.forecast.hourly[5].precip_period = undefined;
assert.equal(c.hourlyWeather(timelineForecast,false,0).total,null,'Unknown provider intervals cannot be summed');
timelineForecast.forecast.hourly[5].precip_period = 'preceding-hour';
timelineForecast.forecast.hourly.splice(7,1);
assert.equal(c.hourlyWeather(timelineForecast,false,0).total,null,'A missing hour cannot produce a complete total');
assert.equal(c.hourlyWeather({},true,0).rows.length,0);
const dstForecast = {forecast:{daily:[0,90000,172800].map(day_start_local=>({day_start_local})),
  hourly:Array.from({length:48},(_,i)=>({time:(i+1)*3600,precip:0,precip_period:'preceding-hour'}))}};
assert.equal(c.hourlyWeather(dstForecast,true,3600).rows.length,23,'Amounts follow a 23-hour provider day');
assert.equal(c.hourlyWeather(dstForecast,true,3600).total,0,'A complete dry day is a valid zero');
const extraRain = {forecast:{hourly:[{time:3600,precip:0.4,precip_period:'preceding-hour',precip_source:'Open-Meteo',visibility:1000}]}};
const primaryRain = {forecast:{hourly:[{time:3600,precip:0,precip_period:'preceding-hour',visibility:0}]}};
const merged = c.withForecastContext(primaryRain,extraRain).forecast.hourly[0];
assert.equal(merged.precip,0,'A known primary zero amount is preserved');
assert.equal(merged.visibility,0,'Observed zero visibility is preserved');
delete primaryRain.forecast.hourly[0].precip_period;
assert.equal(c.withForecastContext(primaryRain,extraRain).forecast.hourly[0].precip_source,'Open-Meteo','Supplemental amount provenance follows its interval');
const offsetModel = {forecast:{hourly:[{time:5400,precip:0.5,precip_period:'preceding-hour',precip_source:'Open-Meteo'}]}};
assert.equal(c.withForecastContext({forecast:{hourly:[{time:3600}]}},offsetModel).forecast.hourly[0].precip,undefined,'Half-hour timezone offsets cannot shift accumulation intervals');
console.log('Forecast desk: hourly accumulation, visibility gaps, provider day boundaries, missing values and normalized atmosphere passed.');
