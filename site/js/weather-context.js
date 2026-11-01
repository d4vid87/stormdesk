// Display facts about a reading without mistaking model agreement for forecast accuracy.
export function readingInfo(fc, field, now = Date.now()) {
  const c = fc?.current_conditions || {};
  const source = c._sources?.[field];
  const at = source?.at ?? c.time ?? c.timestamp;
  const origin = source?.name || (field === 'wbgt' ? 'Calculated estimate · temperature, humidity and solar inputs' : fc?._provider || 'Forecast estimate');
  const age = Number.isFinite(at) ? Math.max(0, Math.floor((now / 1000 - at) / 60)) : null;
  const saved = fc?._cached && (!source || source.at <= (Number.isFinite(fc._savedAt) ? fc._savedAt / 1000 : c.time ?? Infinity));
  return `${saved ? 'Saved data · ' : ''}${origin} · ${age == null ? 'time unavailable' : age < 1 ? 'less than a minute old' : `${age} min old`}`
    + (Number.isFinite(at) ? ` · ${new Date(at * 1000).toLocaleString()}` : '');
}

export function forecastTime(time, utcOffset = 0) {
  if (typeof time === 'number') return time;
  if (typeof time !== 'string') return NaN;
  return /(?:Z|[+-]\d{2}:\d{2})$/.test(time) ? Date.parse(time) / 1000
    : Date.parse(time + 'Z') / 1000 - utcOffset;
}

export function modelAgreement(models, start, end, metric = false) {
  const hours = models?.hourly;
  if (!hours?.time?.length) return 'Model agreement unavailable';
  const keys = Object.keys(hours).filter(key => key.startsWith('temperature_2m_'));
  let spread = 0, count = 0;
  hours.time.forEach((time, i) => {
    const at = forecastTime(time, models.utc_offset_seconds);
    if (!Number.isFinite(at) || at < start || at >= end) return;
    const values = keys.map(key => hours[key]?.[i]).filter(Number.isFinite);
    if (values.length < 2) return;
    count++;
    spread = Math.max(spread, Math.max(...values) - Math.min(...values));
  });
  if (!count) return 'Model agreement unavailable for this day';
  const celsius = metric ? spread : spread / 1.8;
  return `${celsius < 2 ? 'Small' : celsius < 4 ? 'Moderate' : 'Wide'} temperature spread · up to ${spread.toFixed(1)}°${metric ? 'C' : 'F'} apart · ${count} comparable hours`;
}
