// Forecast values already use the selected units; compare them without converting again.
export function weatherChanges(fc, metric = false, now = Date.now() / 1000) {
  const result = { status:'unavailable', hours:[], samples:[], temperature:null, wind:null, cloud:null,
    complete:false, saved:!!fc?._cached, savedAt:Number.isFinite(fc?._savedAt) ? fc._savedAt : null };
  if (!Number.isFinite(now)) return result;
  const source = Array.isArray(fc?.forecast?.hourly) ? fc.forecast.hourly : [];
  const available = [...new Map(source.filter(h => Number.isFinite(h?.time) && h.time >= now - 3600 && h.time <= now + 43200)
    .map(h => [h.time, h])).values()].sort((a, b) => a.time - b.time);
  if (!available.length || available[0].time > now + 3600) return result;
  const current = available.findLastIndex(h => h.time <= now);
  const hours = available.slice(Math.max(0, current));
  result.hours = hours;
  if (hours.length < 2) return result;
  const start = hours[0];
  const change = (key, valid = Number.isFinite, peak = false) => {
    if (!valid(start[key])) return null;
    let end = null;
    for (const hour of hours.slice(1)) {
      if (!valid(hour[key])) continue;
      if (!end || (peak ? hour[key] > end[key] : Math.abs(hour[key] - start[key]) > Math.abs(end[key] - start[key]))) end = hour;
    }
    return end ? {start, end, delta:end[key] - start[key]} : null;
  };
  result.temperature = change('air_temperature');
  if (result.temperature) result.temperature.significant = Math.abs(result.temperature.delta) >= (metric ? 3 : 5);
  result.wind = change('wind_gust', n => Number.isFinite(n) && n >= 0, true);
  result.cloud = change('cloud_cover', n => Number.isFinite(n) && n >= 0 && n <= 100);
  // Missing hours or temperatures cannot support a claim of steady temperatures.
  result.complete = hours.at(-1).time >= now + 39600 && hours.every((h, i) => Number.isFinite(h.air_temperature) && (!i || h.time - hours[i - 1].time <= 3600));
  const temperatures = hours.filter(h => Number.isFinite(h.air_temperature));
  result.samples = [...new Set([temperatures[0], temperatures[Math.floor((temperatures.length - 1) / 2)], temperatures.at(-1)].filter(Boolean))];
  if (result.temperature || result.wind || result.cloud) result.status = 'ok';
  return result;
}
