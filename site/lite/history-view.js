import { settings, U, msToWind, num } from '../js/app.js';
import * as api from '../js/api.js';
import { recentHistory } from './history-cache.js';

function browserRows(context, since) {
  const metric = settings().units === 'metric';
  return recentHistory(context).filter((row) => row.time >= since).map((row) => ({
    time: row.time,
    temp: row.tempC == null ? null : metric ? row.tempC : row.tempC * 9 / 5 + 32,
    wind: msToWind(row.windMs),
    rain: row.rainMm == null ? null : metric ? row.rainMm : row.rainMm / 25.4,
    source: row.source,
  }));
}

async function measuredRows(since, now) {
  let observations = [];
  let source = '';
  if (window.__WD_SRV !== undefined) {
    try {
      observations = (await api.localObs(Math.ceil((now - since) / 3600))).obs || [];
      source = 'StormDesk archive';
    } catch { /* An unavailable host does not hide browser history. */ }
  }
  if (!observations.length && settings().token && settings().stationId && !settings().stationSource) {
    try {
      let deviceId = settings().deviceId;
      if (!/^\d+$/.test(String(deviceId || ''))) {
        const station = (await api.station()).stations?.[0];
        deviceId = station?.devices?.find((device) => device.device_type === 'ST')?.device_id
          || station?.devices?.find((device) => device.device_type === 'AR')?.device_id;
      }
      if (deviceId) {
        observations = (await api.deviceObs(deviceId, since, now)).obs || [];
        source = 'Tempest history';
      }
    } catch { /* The saved browser samples remain available offline. */ }
  }
  return {
    source,
    rows: observations.filter((row) => row[api.OBS.time] >= since).map((row) => ({
      time: row[api.OBS.time], temp: row[api.OBS.temp], wind: row[api.OBS.windAvg],
      rain: row[api.OBS.dayRain], source: 'station',
    })),
  };
}

export async function renderHistory({ context, hours, status, container }) {
  const now = Math.floor(Date.now() / 1000);
  const since = now - hours * 3600;
  const saved = browserRows(context, since);
  const measured = await measuredRows(since, now);
  const byHour = new Map();
  for (const row of [...saved, ...measured.rows]) {
    if (Number.isFinite(row.time)) byHour.set(Math.floor(row.time / 3600), row);
  }
  const rows = [...byHour.values()].sort((a, b) => b.time - a.time);
  container.replaceChildren();
  if (!rows.length) {
    status.textContent = 'No past readings yet. History begins as this browser receives weather updates, or connects to an archive or Tempest account.';
    return;
  }
  const heading = document.createElement('div');
  heading.className = 'history-row history-heading';
  heading.innerHTML = '<span>Time</span><span>Temp</span><span>Wind</span><span>Rain today</span>';
  container.append(heading);
  for (const row of rows) {
    const item = document.createElement('div');
    item.className = 'history-row';
    const values = [
      `${new Date(row.time * 1000).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}${row.source === 'forecast' ? ' · estimate' : ''}`,
      row.temp == null ? '—' : `${num(row.temp)}${U.temp()}`,
      row.wind == null ? '—' : `${num(row.wind)} ${U.wind()}`,
      row.rain == null ? '—' : `${num(row.rain, 2)} ${U.precip()}`,
    ];
    for (const value of values) {
      const cell = document.createElement('span');
      cell.textContent = value;
      item.append(cell);
    }
    container.append(item);
  }
  status.textContent = `${rows.length} hourly samples · ${measured.source || 'saved in this browser'}. Browser samples are collected only while the page is running.`;
}
