import { coords, U, num, timeStr, deg2compass } from './app.js';
import { wx } from './icons.js';

const $ = (id) => document.getElementById(`watch-${id}`);
const text = (id, value) => { $(id).textContent = value; };
const value = (v, unit = '', digits = 0) => `${num(v, digits)}${unit}`;

function render(fc) {
  const c = fc.current_conditions || {};
  const day = fc.forecast?.daily?.[0] || {};
  text('location', coords().name || 'Home station');
  text('station', coords().name || 'Home station');
  text('updated', c.time ? `Weather updated ${new Date(c.time * 1000).toLocaleDateString()} · ${timeStr(c.time)}` : 'Update time unavailable');
  $('icon').innerHTML = c.icon ? wx(c.icon, 44) : '';
  text('temp', value(c.air_temperature, U.temp()));
  text('condition', c.conditions || 'Conditions unavailable');
  text('feels', `Feels like ${value(c.feels_like, '°')}`);
  text('range', `High ${value(day.air_temp_high, '°')} · Low ${value(day.air_temp_low, '°')}`);
  text('direction', c.wind_direction == null ? '—' : deg2compass(c.wind_direction));
  text('wind', num(c.wind_avg));
  text('wind-unit', U.wind());
  text('gust', `Gusts ${value(c.wind_gust, ` ${U.wind()}`)}`);
  $('needle').hidden = c.wind_direction == null || !Number.isFinite(+c.wind_direction);
  $('needle').style.setProperty('--bearing', `${Number(c.wind_direction) || 0}deg`);
  text('dew', value(c.dew_point, '°'));
  text('humidity', value(c.relative_humidity, '%'));
  const pressureUnit = document.createElement('small');
  pressureUnit.textContent = U.press();
  $('pressure').textContent = num(c.sea_level_pressure, 2);
  $('pressure').append(pressureUnit);
  text('rain', value(c.precip_accum_local_day, ` ${U.precip()}`, 2));
  text('uv', num(c.uv));
  text('summary-wind', `${c.wind_direction == null ? '' : deg2compass(c.wind_direction) + ' '}${value(c.wind_avg, ` ${U.wind()}`)}`);
  text('summary-rain', $('rain').textContent);
  text('summary-pressure', value(c.sea_level_pressure, ` ${U.press()}`, 2));
  const strikes = c.lightning_strike_count_last_3hr;
  text('lightning', strikes == null ? 'Lightning data unavailable' : strikes === 0 ? 'No strikes detected' : `${num(strikes)} strikes detected`);
  const hours = (fc.forecast?.hourly || []).filter(h => h.time >= Date.now() / 1000).slice(0, 6);
  $('hours').replaceChildren(...hours.map(h => {
    const el = document.createElement('div');
    el.className = 'watch-hour';
    const time = document.createElement('time');
    time.dateTime = new Date(h.time * 1000).toISOString();
    time.textContent = timeStr(h.time);
    const icon = document.createElement('span');
    icon.innerHTML = h.icon ? wx(h.icon, 28) : '';
    icon.title = h.conditions || '';
    const temp = document.createElement('b');
    temp.textContent = value(h.air_temperature, '°');
    const rain = document.createElement('span');
    rain.textContent = value(h.precip_probability, '%');
    rain.title = 'Chance of precipitation';
    el.append(time, icon, temp, rain);
    return el;
  }));
  if (!hours.length) $('hours').textContent = 'Hourly forecast unavailable';
}

window.addEventListener('wd:forecast', e => render(e.detail || {}));
window.addEventListener('wd:alerts', e => {
  $('alerts').replaceChildren();
  for (const feature of e.detail || []) {
    const p = feature.properties || {};
    const card = document.createElement('div');
    card.className = `watch-card watch-alert${['Severe', 'Extreme'].includes(p.severity) ? ' severe' : ''}`;
    const title = document.createElement('h3');
    title.textContent = p.event || 'Weather alert';
    const meta = document.createElement('p');
    const ends = new Date(p.ends || p.expires);
    meta.textContent = [p.senderName, Number.isNaN(+ends) ? '' : `Until ${ends.toLocaleString()}`].filter(Boolean).join(' · ');
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'View details';
    const description = document.createElement('p');
    description.textContent = [p.description, p.instruction].filter(Boolean).join('\n\n') || 'No further details available.';
    details.append(summary, description);
    card.append(title, meta, details);
    $('alerts').append(card);
  }
  if (!$('alerts').children.length) {
    const empty = document.createElement('div');
    empty.className = 'watch-card watch-muted';
    empty.textContent = 'No active weather alerts';
    $('alerts').append(empty);
  }
});

window.addEventListener('wd:settings', () => {
  render({});
  $('alerts').replaceChildren();
  const pending = document.createElement('div');
  pending.className = 'watch-card watch-muted';
  pending.textContent = 'Waiting for weather alerts';
  $('alerts').append(pending);
});
