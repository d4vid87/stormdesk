// Exercise real HTTP handlers and SQLite isolation; never uses the user's app data or credentials.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const build = spawn('cargo', ['build', '--manifest-path', join(root, 'src-tauri/Cargo.toml'),
  '--no-default-features', '--bin', 'stormdesk', '--message-format=json'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let buildOutput = '', buildErrors = '';
build.stdout.on('data', chunk => { buildOutput += chunk; });
build.stderr.on('data', chunk => { buildErrors = (buildErrors + chunk).slice(-64000); });
const buildCode = await new Promise((resolve, reject) => { build.once('error', reject); build.once('close', resolve); });
assert.equal(buildCode, 0, buildErrors);
const binary = buildOutput.split('\n').flatMap(line => {
  try { const record = JSON.parse(line); return record.reason === 'compiler-artifact' && record.executable ? [record.executable] : []; }
  catch { return []; }
}).find(path => /stormdesk(?:\.exe)?$/.test(path));
assert.ok(binary, 'Cargo must report the headless executable');

const reservation = createServer();
await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const base = 'http://127.0.0.1:' + port;
const dir = await mkdtemp(join(tmpdir(), 'stormdesk-archive-http-'));
const marker = 'archive-test-' + randomUUID();
const secrets = ['fake-ecowitt-app-' + marker, 'fake-ecowitt-api-' + marker, 'fake-ecowitt-mac-' + marker, 'fake-profile-token-' + marker];
let child, childOutput = '';
try {
  // No coordinates, active forecast token, MQTT, webhook or pulled source: these checks stay local.
  // Ecowitt credential sentinels are only tested for redaction; cloud recovery is never requested.
  await writeFile(join(dir, 'config.json'), JSON.stringify({ settings: {
    httpPort: port, legacyLanAccess: true, stationSource: 'ecowitt', stationId: 'A', stationName: marker,
    token: '', rules: [], ecowittAppKey: secrets[0], ecowittApiKey: secrets[1], ecowittMac: secrets[2],
    savedStations: [{ id: 'saved', label: 'Saved station', profile: { stationId: 'saved', token: secrets[3], ecowittApiKey: secrets[1] } }],
  } }));
  child = spawn(binary, ['--headless'], { cwd: root, env: { ...process.env, WD_DATA_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = new Promise(resolve => child.once('close', resolve));
  let startupError;
  child.once('error', error => { startupError = error; });
  child.stdout.on('data', chunk => { childOutput = (childOutput + chunk).slice(-16000); });
  child.stderr.on('data', chunk => { childOutput = (childOutput + chunk).slice(-16000); });
  child._testClosed = closed;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError;
    if (child.exitCode != null) throw new Error('Test server exited: ' + childOutput);
    try {
      const response = await fetch(base + '/config', { signal: AbortSignal.timeout(300) });
      const config = await response.json();
      if (config.settings?.stationName === marker) { ready = true; break; }
    } catch {}
    await pause(50);
  }
  assert.ok(ready, 'Isolated server did not start on its reserved port: ' + childOutput);
  const request = async (path, { method = 'GET', body, raw, status = 200 } = {}) => {
    const response = await fetch(base + path, { method, signal: AbortSignal.timeout(5000),
      ...(body !== undefined || raw !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: raw ?? JSON.stringify(body) } : {}) });
    const text = await response.text();
    assert.equal(response.status, status, method + ' ' + path + ': ' + text.slice(0, 500));
    return text ? JSON.parse(text) : null;
  };
  const epoch = Math.floor(Date.now() / 1000) - 120;
  const reviewPath = '/history/review?from=' + (epoch - 1) + '&to=' + (epoch + 1);
  const tuplesPath = '/history/tuples?from=' + (epoch - 1) + '&to=' + (epoch + 1);
  const tuple = (temperature, timestamp = epoch) => {
    const row = Array(19).fill(null); row[0] = timestamp; row[7] = temperature; row[8] = 50; row[12] = 0;
    return row;
  };
  const initial = await request(reviewPath);
  assert.match(initial.context, /^[a-f0-9]{64}$/);
  assert.deepEqual(initial.obs, []);
  const contextA = initial.context;
  const editA = (body, status = 200) => request('/archive/edit', { method: 'POST', body: { context: contextA, ...body }, status });
  const imported = await editA({ action: 'import', rows: [tuple(12.5)] });
  assert.equal(imported.inserted, 1);
  assert.equal((await editA({ action: 'import', rows: [tuple(99)] }, 400)).error.includes('temperature'), true);
  const duplicate = await editA({ action: 'import', rows: [tuple(22)] });
  assert.equal(duplicate.inserted, 0); assert.equal(duplicate.duplicates, 1);
  assert.equal((await request(reviewPath)).obs[0][7], 12.5, 'duplicate imports cannot overwrite raw observations');
  const note = await editA({ action: 'note', ts: epoch, kind: 'note', text: 'Gauge cleaned <script>literal text</script>' });
  const snow = await editA({ action: 'note', ts: epoch, kind: 'snowfall', text: 'Manual ruler', value: 4.5 });
  let review = await request(reviewPath);
  assert.equal(review.notes.find(row => row.id === note.id).text, 'Gauge cleaned <script>literal text</script>');
  assert.equal(review.notes.find(row => row.id === snow.id).value, 4.5);
  const exclusion = await editA({ action: 'note', ts: epoch, until: epoch, kind: 'exclude', text: 'Sensor maintenance' });
  assert.equal((await request(reviewPath)).obs.length, 1, 'exclusions must preserve original data');
  assert.deepEqual((await request(tuplesPath)).obs, [], 'excluded observations must leave analysis');
  await editA({ action: 'delete-note', id: exclusion.id });
  assert.equal((await request(tuplesPath)).obs[0][7], 12.5, 'removing an exclusion restores analysis');
  await editA({ action: 'delete-note', id: note.id });
  assert.ok(!(await request(reviewPath)).notes.some(row => row.id === note.id));

  // Invalid batches must not partially write their valid first row.
  await editA({ action: 'import', rows: [tuple(10, epoch + 1), tuple(999, epoch + 2)] }, 400);
  const afterBadImport = await request('/history/review?from=' + epoch + '&to=' + (epoch + 3));
  assert.equal(afterBadImport.obs.length, 1);
  for (const body of [
    { action: 'note', ts: epoch, kind: 'snowdepth', value: -1 },
    { action: 'note', ts: epoch, until: epoch - 1, kind: 'note', text: 'bad range' },
    { action: 'note', ts: epoch, kind: 'exclude', text: '' },
    { action: 'delete-note', id: 0 }, { action: 'import', rows: [[epoch]] }, { action: 'unknown' },
  ]) await editA(body, 400);
  await request('/archive/edit', { status: 405 });
  await request('/archive/edit', { method: 'POST', raw: '{broken', status: 409 });
  await request('/archive/edit', { method: 'POST', body: { action: 'note' }, status: 409 });

  // Real ingest proves the channels response is populated, not merely an empty-array contract.
  const upload = await fetch(base + '/ingest', { method: 'POST', body: 'ID=A&tempf=68&tempinf=72&humidityin=40&wh65batt=1&soilmoisture1=25', signal: AbortSignal.timeout(5000) });
  assert.equal(upload.status, 200); assert.equal(await upload.text(), 'success');
  const channels = await request('/history/channels?latest=1');
  assert.ok(Array.isArray(channels));
  for (const row of channels) {
    assert.deepEqual(Object.keys(row).sort(), ['name', 'ts', 'unit', 'value']);
    assert.ok(Number.isInteger(row.ts) && Number.isFinite(row.value));
  }
  assert.equal(channels.find(row => row.name === 'battery_wh65').unit, 'low');
  assert.equal(channels.find(row => row.name === 'battery_wh65').value, 1);
  assert.equal(channels.find(row => row.name === 'soil_moisture_1').value, 25);
  const setStation = async stationId => {
    const config = await request('/config');
    return request('/config', { method: 'PUT', body: { _rev: config._rev || 0, settings: { stationId } } });
  };
  await setStation('B');
  const stationB = await request(reviewPath);
  assert.notEqual(stationB.context, contextA);
  assert.deepEqual(stationB.obs, []); assert.deepEqual(stationB.notes, []);
  assert.deepEqual(await request('/history/channels?latest=1'), []);
  await editA({ action: 'note', ts: epoch, kind: 'note', text: 'Must not enter B' }, 409);
  await request('/archive/edit', { method: 'POST', body: { context: stationB.context, action: 'import', rows: [tuple(-5)] } });
  assert.equal((await request(reviewPath)).obs[0][7], -5);
  await setStation('A');
  review = await request(reviewPath);
  assert.equal(review.context, contextA); assert.equal(review.obs[0][7], 12.5);
  assert.ok(review.notes.some(row => row.id === snow.id), 'station A retains its own notes');
  assert.ok((await request('/history/channels?latest=1')).some(row => row.name === 'battery_wh65'));
  await setStation('B');
  assert.equal((await request(reviewPath)).obs[0][7], -5, 'station B retains the same timestamp independently');

  const publicConfig = await request('/config-public');
  const publicText = JSON.stringify(publicConfig);
  for (const secret of secrets) assert.ok(!publicText.includes(secret), 'public configuration leaked a test credential');
  assert.equal(publicConfig.settings.ecowittAppKey, '');
  assert.equal(publicConfig.settings.ecowittApiKey, '');
  assert.equal(publicConfig.settings.ecowittMac, '');
  assert.ok(!Object.hasOwn(publicConfig.settings.savedStations[0].profile, 'token'));
  assert.ok(!Object.hasOwn(publicConfig, '_access'));
  const current = await request('/config');
  await request('/config', { method: 'PUT', body: { _rev: current._rev, settings: { legacyLanAccess: false } } });
  // The server deliberately trusts its loopback owner even after remote legacy access is disabled.
  assert.equal((await request(reviewPath)).obs[0][7], -5);
  assert.equal((await request('/config-public')).settings.stationId, 'B');
  console.log('Archive HTTP: imports, notes, exclusions, invalid requests, channel ingestion, station isolation, stale-context rejection and public credential redaction passed.');
} finally {
  if (child && child.exitCode == null && child.signalCode == null) {
    child.kill('SIGTERM');
    const stopped = await Promise.race([child._testClosed.then(() => true), pause(3000).then(() => false)]);
    if (!stopped) { child.kill('SIGKILL'); await child._testClosed; }
  }
  await rm(dir, { recursive: true, force: true });
}
