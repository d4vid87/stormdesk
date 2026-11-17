import assert from 'node:assert/strict';
import { weatherChanges } from '../site/js/weather-changes.js';

const now = 1800000000;
const forecast = hours => ({forecast:{hourly:hours}});
const row = (hour, temperature, extra = {}) => ({time:now + hour * 3600,air_temperature:temperature,...extra});
const hours = Array.from({length:13}, (_, i) => row(i, 70 - i, {wind_gust:5 + i,cloud_cover:i * 5}));
let result = weatherChanges(forecast(hours), false, now);
assert.equal(result.status, 'ok');
assert.equal(result.temperature.delta, -12);
assert.equal(result.temperature.end.time, now + 43200);
assert.equal(result.temperature.significant, true);
assert.equal(result.wind.delta, 12, 'Wind remains in the supplied speed units');
assert.equal(result.cloud.delta, 60);
assert.equal(result.complete, true);
assert.deepEqual(result.samples.map(h => h.time), [now, now + 21600, now + 43200]);
assert.equal(hours[0].air_temperature, 70, 'Input records are not changed');

const unordered = forecast([row(2, 55), row(1, 60), row(0, 70), row(2, 50), null, {time:'1800000000'}, row(13, -100), row(-2, 100)]);
result = weatherChanges(unordered, false, now);
assert.deepEqual(result.hours.map(h => h.air_temperature), [70, 60, 50], 'Sort, deduplicate, and exclude out-of-window or invalid timestamps');
assert.equal(result.temperature.delta, -20);
assert.equal(result.complete, false, 'A short forecast cannot imply calm over twelve hours');

result = weatherChanges(forecast([row(-1, 90), row(0, 70), row(1, 72), row(2, 60), row(3, 70)]), false, now);
assert.equal(result.temperature.start.air_temperature, 70, 'Latest current-hour forecast wins over the previous hour');
assert.equal(result.temperature.end.time, now + 7200, 'An intermediate peak change is not lost when temperature returns to baseline');
assert.equal(result.temperature.delta, -10);

result = weatherChanges(forecast([row(0, 0, {wind_gust:0,cloud_cover:0}), row(1, -3, {wind_gust:10,cloud_cover:35})]), true, now);
assert.equal(result.temperature.start.air_temperature, 0, 'Zero is a valid temperature');
assert.equal(result.temperature.delta, -3, 'Metric deltas are not converted again');
assert.equal(result.temperature.significant, true);
assert.equal(result.wind.delta, 10);
assert.equal(result.cloud.delta, 35);
assert.equal(weatherChanges(forecast([row(0, 0), row(1, -2)]), true, now).temperature.significant, false);
assert.equal(weatherChanges(forecast([row(0, 70), row(1, 74)]), false, now).temperature.significant, false);

for (const unavailable of [null, {}, forecast([]), forecast([row(0, 50)]), forecast([row(2, 50),row(3, 60)]), forecast([row(-3, 50),row(-2, 60)])]) {
  result = weatherChanges(unavailable, false, now);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.complete, false);
}
assert.equal(weatherChanges(forecast([row(1, 50),row(2, 60)]), false, now).status, 'ok', 'Next hourly forecast may provide the baseline');
result = weatherChanges(forecast([row(0, null),row(1, 50)]), false, now);
assert.equal(result.temperature, null, 'No fabricated current temperature from a missing baseline');
assert.equal(result.status, 'unavailable');
assert.equal(weatherChanges(forecast([row(0, NaN),row(1, Infinity)]), false, now).temperature, null);
assert.equal(weatherChanges(forecast(hours), false, NaN).status, 'unavailable');

const missing = hours.map(h => ({...h})); missing[5].air_temperature = null;
assert.equal(weatherChanges(forecast(missing), false, now).complete, false, 'Missing temperature cannot imply steady weather');
assert.equal(weatherChanges(forecast(hours.filter((_,i) => i !== 5)), false, now).complete, false, 'Gaps cannot imply steady weather');
const saved = {...forecast(hours),_cached:true,_savedAt:(now - 86400) * 1000};
result = weatherChanges(saved, false, now);
assert.equal(result.saved, true, 'Saved data stays explicitly marked');
assert.equal(result.savedAt, saved._savedAt);
assert.equal(result.status, 'ok', 'A cached forecast may still cover the current period');
assert.equal(weatherChanges(saved, false, now + 86400).status, 'unavailable', 'Expired cached hours cannot masquerade as current weather');
console.log('Weather changes: hourly deltas, units, missing data, chronology, coverage and saved forecasts passed.');
