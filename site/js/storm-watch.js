// Radar and Instrument share active official alerts and their complete details.
import { coords } from './app.js';
import { renderHeroAlerts } from './desk.js';
import { radarAlertColor } from './alert-style.js';
const $ = (id) => document.getElementById(id);
let warnings = [];
const point = () => `${coords().lat},${coords().lon}`;
let alertLocation = point();

function renderBanner(message, badge = 'RADAR') {
  $('radar-banner-badge').textContent = badge;
  $('radar-banner-text').textContent = message;
  $('radar-banner').classList.toggle('has-warnings', !!warnings.length);
  $('radar-banner').dataset.severity = warnings[0]?.properties?.severity || '';
  if (warnings.length) $('radar-banner').style.setProperty('--alert-color', radarAlertColor(warnings[0].properties?.event));
  else $('radar-banner').style.removeProperty('--alert-color');
  $('radar-banner-details').hidden = !warnings.length;
}

window.addEventListener('wd:alerts', (event) => {
  alertLocation = point();
  renderHeroAlerts(event.detail || []);
  warnings = (event.detail || [])
    .sort((a, b) => {
      const rank = (p) => ({Extreme:0, Severe:1, Moderate:2, Minor:3, Unknown:4}[p.severity] ?? 4) - (/emergency/i.test(p.event || '') ? .1 : 0);
      return rank(a.properties || {}) - rank(b.properties || {});
    });
  if (!warnings.length) return renderBanner('No active station-area weather alerts');
  const headlines = warnings.map(({ properties: p }) => {
    const until = p.ends || p.expires;
    return [p.event, p.areaDesc, until && `Until ${new Date(until).toLocaleString()}`].filter(Boolean).join(' · ');
  });
  renderBanner(headlines.join('   ✦   '), warnings.some(({ properties: p }) => /emergency/i.test(p.event || '')) ? 'EMERGENCY' : 'National Weather Service');
});

window.addEventListener('wd:alerts-error', (event) => {
  alertLocation = point();
  warnings = [];
  renderHeroAlerts(null, event.detail || 'Warning feed unavailable · check official sources');
  renderBanner(event.detail || 'Warning feed unavailable · check official sources');
});
window.addEventListener('wd:settings', () => {
  if (point() === alertLocation) return;
  alertLocation = point();
  warnings = [];
  renderHeroAlerts(null);
  renderBanner('Checking for weather warnings…');
});

$('radar-banner-details').addEventListener('click', () => {
  const list = $('radar-alert-list');
  list.replaceChildren(...warnings.map(({ properties: p }) => {
    const article = document.createElement('article');
    const title = document.createElement('h3');
    title.textContent = p.event || 'Weather warning';
    const meta = document.createElement('p');
    meta.className = 'radar-alert-meta';
    const stamp = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}) : 'Not supplied';
    meta.textContent = [`Severity: ${p.severity || 'Unknown'}`, `Affected areas: ${p.areaDesc || 'Not supplied'}`, p.senderName,
      `Issued (device time): ${stamp(p.sent)}`, `Effective (device time): ${stamp(p.effective)}`,
      `Expires (device time): ${stamp(p.expires)}`, `Event ends (device time): ${stamp(p.ends)}`].filter(Boolean).join('\n');
    const body = document.createElement('p');
    body.textContent = [p.description, p.instruction].filter(Boolean).join('\n\n') || 'No further details available.';
    article.append(title, meta, body);
    return article;
  }));
  $('radar-alert-dialog').showModal();
});

if (location.search.includes('radartest')) {
  window.dispatchEvent(new CustomEvent('wd:alerts', { detail: [
    { properties: { event: 'Heat Advisory', severity: 'Moderate' } },
    { properties: { event: 'Tornado Warning', severity: 'Extreme', areaDesc: 'Test county' } },
    { properties: { event: 'Flash Flood Emergency', severity: 'Extreme', areaDesc: 'Test town' } },
  ] }));
  if (warnings.length !== 3 || $('radar-banner-badge').textContent !== 'EMERGENCY'
    || $('radar-banner-details').hidden || !$('radar-banner-text').textContent.startsWith('Flash Flood Emergency'))
    throw new Error('radar: warning filter or priority failed');
  $('radar-banner-details').click();
  if (!$('radar-alert-dialog').open || $('radar-alert-list').children.length !== 3)
    throw new Error('radar: warning details failed');
  $('radar-alert-dialog').close();
  window.dispatchEvent(new CustomEvent('wd:alerts', { detail: [] }));
  if (!$('radar-banner-details').hidden || !$('radar-banner-text').textContent.includes('No active'))
    throw new Error('radar: empty state failed');
  document.documentElement.dataset.radarSelftest = 'ok';
}
