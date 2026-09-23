// Radar keeps HookEcho unobstructed and shows only active official warnings.
import { coords } from './app.js';
const $ = (id) => document.getElementById(id);
let warnings = [];
const point = () => `${coords().lat},${coords().lon}`;
let alertLocation = point();

function renderBanner(message, badge = 'RADAR') {
  $('radar-banner-badge').textContent = badge;
  $('radar-banner-text').textContent = message;
  $('radar-banner').classList.toggle('has-warnings', !!warnings.length);
  $('radar-banner-details').hidden = !warnings.length;
}

window.addEventListener('wd:alerts', (event) => {
  alertLocation = point();
  warnings = (event.detail || [])
    .filter((feature) => /\b(warning|emergency)\b/i.test(feature.properties?.event || ''))
    .sort((a, b) => {
      const rank = (p) => /emergency/i.test(p.event || '') ? 0 : p.severity === 'Extreme' ? 1 : p.severity === 'Severe' ? 2 : 3;
      return rank(a.properties || {}) - rank(b.properties || {});
    });
  if (!warnings.length) return renderBanner('No active weather warnings or emergencies');
  const headlines = warnings.map(({ properties: p }) => {
    const until = p.ends || p.expires;
    return [p.event, p.areaDesc, until && `Until ${new Date(until).toLocaleString()}`].filter(Boolean).join(' · ');
  });
  renderBanner(headlines.join('   ✦   '), warnings.some(({ properties: p }) => /emergency/i.test(p.event || '')) ? 'EMERGENCY' : 'WARNING');
});

window.addEventListener('wd:alerts-error', (event) => {
  alertLocation = point();
  warnings = [];
  renderBanner(event.detail || 'Warning feed unavailable · check official sources');
});
window.addEventListener('wd:settings', () => {
  if (point() === alertLocation) return;
  alertLocation = point();
  warnings = [];
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
    meta.textContent = [p.areaDesc, p.senderName, p.ends || p.expires ? `Until ${new Date(p.ends || p.expires).toLocaleString()}` : ''].filter(Boolean).join(' · ');
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
  if (warnings.length !== 2 || $('radar-banner-badge').textContent !== 'EMERGENCY'
    || $('radar-banner-details').hidden || !$('radar-banner-text').textContent.startsWith('Flash Flood Emergency'))
    throw new Error('radar: warning filter or priority failed');
  $('radar-banner-details').click();
  if (!$('radar-alert-dialog').open || $('radar-alert-list').children.length !== 2)
    throw new Error('radar: warning details failed');
  $('radar-alert-dialog').close();
  window.dispatchEvent(new CustomEvent('wd:alerts', { detail: [] }));
  if (!$('radar-banner-details').hidden || !$('radar-banner-text').textContent.includes('No active'))
    throw new Error('radar: empty state failed');
  document.documentElement.dataset.radarSelftest = 'ok';
}
