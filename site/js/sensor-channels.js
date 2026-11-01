import { settings, saveSettings, everyVisible, expires, notify, notifHistory } from './app.js';
import { chart } from './charts.js';

export function groupChannels(rows) {
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row.name !== 'string' || row.name.length > 80 ||
        !Number.isFinite(row.ts) || row.ts <= 0 || !Number.isFinite(row.value) ||
        !['°C', '%', 'V', 'low', 'µg/m³', 'ppm'].includes(row.unit)) continue;
    if (row.unit === 'low' && row.value !== 0 && row.value !== 1) continue;
    const key = row.name + ':' + row.unit;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  for (const rows of groups.values()) rows.sort((a, b) => a.ts - b.ts);
  return groups;
}

export function channelLabel(name) {
  return name.replace(/^battery_/, '').replace(/_/g, ' ').replace(/pm25/g, 'PM2.5')
    .replace(/co2/g, 'CO₂').replace(/^./, c => c.toUpperCase()) +
    (name.startsWith('battery_') ? ' battery' : '');
}

export function channelReading(row, metric, now = Date.now()) {
  const stale = row.ts * 1000 < now - 15 * 60_000 || row.ts * 1000 > now + 60_000;
  if (row.unit === 'low') return stale ? 'Unknown · last report ' + (row.value ? 'low' : 'normal') : row.value ? 'Low' : 'Normal';
  const value = row.unit === '°C' && !metric ? row.value * 1.8 + 32 : row.value;
  const unit = row.unit === '°C' && !metric ? '°F' : row.unit;
  return value.toLocaleString(undefined, { maximumFractionDigits: row.unit === 'V' ? 2 : 1 }) + ' ' + unit + (stale ? ' · stale' : '');
}

export function channelRule(row, op, value, hold, id) {
  if (!row || !/^[a-z0-9_]{1,80}$/.test(row.name) ||
      !['°C', '%', 'V', 'low', 'µg/m³', 'ppm'].includes(row.unit) ||
      !['>', '<'].includes(op) || !Number.isFinite(value) ||
      !Number.isInteger(hold) || hold < 0 || hold > 1440 || !id) {
    throw new Error('Select a sensor, a finite threshold, and a hold duration from 0 to 1440 minutes.');
  }
  return { id, metric: 'channel:' + row.name, channelUnit: row.unit, op, value, durMin: hold };
}

export function initSensorChannels() {
  if (!document.getElementById('data') || document.getElementById('sensor-channels')) return;
  const make = (tag, text, cls) => {
    const e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  };
  const panel = make('details', null, 'card');
  panel.id = 'sensor-channels';
  panel.style.marginTop = '16px';
  const summary = make('summary');
  summary.append(make('h2', 'Additional sensors'));
  const status = make('p', 'Open to load the last 24 hours.', 'muted');
  status.setAttribute('role', 'status');
  const label = make('label', 'Sensor ');
  const select = make('select');
  select.id = 'sensor-channel-select';
  label.htmlFor = select.id;
  const reading = make('p');
  const canvas = make('canvas', null, 'chart');
  canvas.id = 'sensor-channel-chart';
  const help = make('p', 'Measurements are archived as reported. Battery flags use 0 = normal and 1 = low; voltage alone does not establish battery health.', 'muted');
  const tableDetails = make('details');
  tableDetails.append(make('summary', 'Reading table'));
  const table = make('table');
  table.style.width = '100%';
  tableDetails.append(table);
  const ruleForm = make('form');
  ruleForm.append(make('h3', 'Sensor alert'));
  const comparisonLabel = make('label', 'When selected sensor is ');
  const comparison = make('select');
  for (const [value, text] of [['>', 'Above'], ['<', 'Below']]) {
    const option = make('option', text); option.value = value; comparison.append(option);
  }
  comparisonLabel.append(comparison);
  const thresholdLabel = make('label');
  const thresholdText = make('span', 'Threshold ');
  const threshold = make('input'); threshold.type = 'number'; threshold.step = 'any'; threshold.required = true;
  thresholdLabel.append(thresholdText, threshold);
  const holdLabel = make('label', 'Hold for minutes ');
  const hold = make('input'); hold.type = 'number'; hold.min = '0'; hold.max = '1440'; hold.step = '1'; hold.value = '0'; hold.required = true;
  holdLabel.append(hold);
  const save = make('button', 'Save sensor alert'); save.type = 'submit';
  const ruleStatus = make('p', 'The station server checks these rules each minute, including while this page is closed. Thresholds use the sensor’s stored units.', 'muted');
  ruleStatus.setAttribute('role', 'status');
  const ruleList = make('div');
  ruleForm.append(comparisonLabel, thresholdLabel, holdLabel, save, ruleStatus, ruleList);
  panel.append(summary, status, label, select, reading, canvas, help, ruleForm, tableDetails);
  document.getElementById('data').append(panel);
  const battery = make('div', null, 'kv-rows');
  battery.id = 'sensor-battery-health';
  battery.textContent = 'Additional sensor batteries: checking…';
  (document.getElementById('health-center') || document.getElementById('health')?.parentElement)?.append(battery);
  let groups = new Map(), serial = 0, batterySerial = 0, loading = false, lastLoaded = 0;
  const seen = new Set(notifHistory().map(entry => entry.id));
  const context = () => {
    const s = settings();
    return JSON.stringify([s.stationSource, s.stationId, s.deviceId, s.wllHost, s.lacrosseEmail, s.ecowittMac, s.activeStationProfile]);
  };
  const request = async (latest) => {
    const response = await fetch((window.__WD_SRV || '') + '/history/channels?' + (latest ? 'latest=1' : 'hours=24'), { signal: expires(15_000) });
    if (!response.ok) throw new Error('Sensor archive unavailable (' + response.status + ').');
    const body = await response.json();
    if (!Array.isArray(body)) throw new Error('Sensor archive returned an invalid response.');
    return groupChannels(body);
  };
  const renderRuleList = () => {
    ruleList.replaceChildren();
    const rules = (settings().rules || []).filter(rule => rule.metric?.startsWith('channel:'));
    if (!rules.length) { ruleList.textContent = 'No sensor alerts saved.'; return; }
    for (const rule of rules) {
      const row = make('div', null, 'row');
      const unit = rule.channelUnit === 'low' ? '(0 normal / 1 low)' : rule.channelUnit || '';
      const description = channelLabel(rule.metric.slice(8)) + ' ' + (rule.op === '<' ? 'below' : 'above') + ' ' + rule.value + ' ' + unit + ' · hold ' + (rule.durMin || 0) + ' min';
      const remove = make('button', 'Remove'); remove.type = 'button';
      remove.setAttribute('aria-label', 'Remove alert: ' + description);
      remove.addEventListener('click', () => {
        if (document.body.classList.contains('public')) { ruleStatus.textContent = 'Pair this screen as an editor to change sensor alerts.'; return; }
        const saved = settings().rules || [];
        saveSettings({ rules: saved.filter(item => rule.id ? item.id !== rule.id : item !== rule) });
        renderRuleList();
      });
      row.append(make('span', description), remove); ruleList.append(row);
    }
  };
  ruleForm.addEventListener('submit', event => {
    event.preventDefault();
    if (document.body.classList.contains('public')) { ruleStatus.textContent = 'Pair this screen as an editor to save sensor alerts.'; return; }
    try {
      const rows = groups.get(select.value) || [];
      if (!threshold.value.trim()) throw new Error('Enter a threshold in the displayed sensor units.');
      const id = 'sensor-' + (globalThis.crypto?.randomUUID?.() || Date.now() + '-' + Math.random().toString(36).slice(2));
      const rule = channelRule(rows[rows.length - 1], comparison.value, Number(threshold.value), Number(hold.value), id);
      saveSettings({ rules: [...(settings().rules || []), rule] });
      ruleStatus.textContent = 'Sensor alert saved. Keep the station server running and configure notification delivery in Settings.';
      renderRuleList();
    } catch (err) { ruleStatus.textContent = err.message; }
  });
  const draw = () => {
    const rows = groups.get(select.value) || [];
    const last = rows[rows.length - 1];
    const metric = settings().units === 'metric';
    const displayValue = r => r.unit === '°C' && !metric ? r.value * 1.8 + 32 : r.value;
    const unit = last?.unit === '°C' && !metric ? '°F' : last?.unit;
    thresholdText.textContent = 'Threshold (' + (last?.unit === 'low' ? '0 normal / 1 low' : last?.unit || 'select a sensor') + ') ';
    save.disabled = !last;
    renderRuleList();
    reading.textContent = last ? channelLabel(last.name) + ': ' + channelReading(last, metric) + ' · ' + new Date(last.ts * 1000).toLocaleString() : '';
    chart(canvas, [{ data: rows.map(r => ({ x: r.ts * 1000, y: displayValue(r) })), color: '#48b8a8' }],
      { label: last ? channelLabel(last.name) : 'Additional sensors', unit, digits: unit === 'low' ? 0 : 1,
        xFormat: x => new Date(x).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
    table.replaceChildren();
    const head = make('tr');
    for (const title of ['Observed', 'Reading']) { const cell = make('th', title); cell.scope = 'col'; head.append(cell); }
    table.append(head);
    // A day of minute observations is bounded; build it only when the table is requested.
    if (tableDetails.open) for (const row of rows) {
      const tr = make('tr');
      tr.append(make('td', new Date(row.ts * 1000).toLocaleString()), make('td', channelReading(row, metric, row.ts * 1000)));
      table.append(tr);
    }
  };
  const refresh = async (force = false) => {
    if (!panel.open || !panel.getClientRects().length || loading || (!force && Date.now() - lastLoaded < 60_000)) return;
    const mine = ++serial, source = context();
    loading = true;
    status.textContent = 'Loading additional sensors…';
    try {
      const loaded = await request(false);
      if (mine !== serial || source !== context()) return;
      groups = loaded;
      lastLoaded = Date.now();
      const selected = select.value;
      select.replaceChildren();
      for (const [key, rows] of groups) {
        const option = make('option', channelLabel(rows[0].name));
        option.value = key;
        select.append(option);
      }
      if (groups.has(selected)) select.value = selected;
      select.disabled = !groups.size;
      status.textContent = groups.size ? groups.size + ' sensor channels · last 24 hours' : 'No additional sensor readings received in the last 24 hours. Connect an Ecowitt, Ambient, Davis, or compatible sensor feed.';
      draw();
    } catch (err) {
      if (mine === serial && source === context()) status.textContent = err.message;
    } finally { if (mine === serial) loading = false; }
  };
  const refreshBattery = async () => {
    const mine = ++batterySerial, source = context();
    try {
      const loaded = await request(true);
      if (mine !== batterySerial || source !== context()) return;
      battery.replaceChildren();
      let count = 0;
      for (const rows of loaded.values()) {
        const last = rows[rows.length - 1];
        if (!last.name.startsWith('battery_')) continue;
        count++;
        const row = make('div');
        row.append(make('span', channelLabel(last.name)), make('span', channelReading(last, true)));
        row.title = new Date(last.ts * 1000).toLocaleString();
        battery.append(row);
        const day = new Date().toLocaleDateString();
        const key = 'sensor-battery:' + source + ':' + last.name + ':' + day;
        if (last.unit === 'low' && last.value === 1 && Date.now() - last.ts * 1000 <= 15 * 60_000 &&
            last.ts * 1000 <= Date.now() + 60_000 && !seen.has(key)) {
          seen.add(key);
          notify({ id: key, category: 'station', title: 'Sensor battery low', body: channelLabel(last.name) + ' reports a low battery.' });
        }
      }
      if (!count) battery.textContent = 'Additional sensor batteries: unknown · no recent battery reports.';
    } catch { if (mine === batterySerial && source === context()) battery.textContent = 'Additional sensor batteries: unavailable.'; }
  };
  select.addEventListener('change', draw);
  tableDetails.addEventListener('toggle', () => { if (tableDetails.open) draw(); });
  panel.addEventListener('toggle', () => { if (panel.open) { refresh(); refreshBattery(); } });
  everyVisible('sensor-channels', 120, canvas, () => refresh());
  everyVisible('sensor-batteries', 120, battery, refreshBattery);
  window.addEventListener('wd:section', e => { if (e.detail === 'data') refresh(); });
  renderRuleList();
  window.addEventListener('wd:archive-change', () => {
    serial++; batterySerial++; loading=false; lastLoaded=0;
    groups.clear(); select.replaceChildren(); draw();
    refresh(true); refreshBattery();
  });
  window.addEventListener('wd:settings', event => {
    if (Object.keys(event.detail || {}).every(key => key === 'rules')) { renderRuleList(); return; }
    serial++; batterySerial++; loading = false; lastLoaded = 0;
    groups.clear(); select.replaceChildren(); table.replaceChildren(); reading.textContent = '';
    battery.textContent = 'Additional sensor batteries: checking…';
    if (panel.open) refresh(true);
  });
}
