import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../site/js/forecast-desk.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const c = vm.createContext({ Date, timeStr: () => '' });
vm.runInContext(source, c);
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
console.log('Forecast desk: provider day boundaries, missing values, forecast windows and normalized atmosphere passed.');
