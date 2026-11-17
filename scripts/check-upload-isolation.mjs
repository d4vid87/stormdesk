// Real HTTP regression checks; all state and credentials belong to a temporary test server.
// STORMDESK_TEST_BIN may point at a frozen pre-fix binary for the same starvation check.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, access, readdir } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, timeout, message) {
  const deadline = performance.now() + timeout;
  while (!predicate() && performance.now() < deadline) await pause(10);
  assert.ok(predicate(), message);
}
let binary = process.env.STORMDESK_TEST_BIN;
if (!binary) {
  const build = spawn('cargo', ['build', '--locked', '--manifest-path', join(root, 'src-tauri/Cargo.toml'),
    '--no-default-features', '--bin', 'stormdesk', '--message-format=json'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = '';
  build.stdout.on('data', chunk => { output += chunk; });
  build.stderr.on('data', chunk => { errors = (errors + chunk).slice(-64000); });
  const code = await new Promise((resolve, reject) => { build.once('error', reject); build.once('close', resolve); });
  assert.equal(code, 0, errors);
  binary = output.split('\n').flatMap(line => {
    try { const row = JSON.parse(line); return row.reason === 'compiler-artifact' && row.executable ? [row.executable] : []; }
    catch { return []; }
  }).find(path => /stormdesk(?:\.exe)?$/.test(path));
  assert.ok(binary, 'Cargo must report the headless executable');
}
const reservation = createServer();
await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const base = 'http://127.0.0.1:' + port;
const dir = await mkdtemp(join(tmpdir(), 'stormdesk-upload-http-'));
const marker = 'upload-test-' + randomUUID();
const sockets = new Set();
let child, closed, output = '', trickleTimer;

async function connect() {
  const socket = createConnection({ host: '127.0.0.1', port });
  const connection = { socket, text: '', closed: false };
  sockets.add(socket);
  socket.setEncoding('utf8');
  socket.on('data', chunk => { connection.text += chunk; });
  socket.on('error', () => {}); // Connection resets are the intentional overload rejection.
  socket.on('close', () => { connection.closed = true; sockets.delete(socket); });
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
  return connection;
}
function headers(method, path, extra = {}) {
  return `${method} ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n` +
    Object.entries(extra).map(([key, value]) => `${key}: ${value}\r\n`).join('') + '\r\n';
}
async function stalled({ method = 'PUT', path = '/config', chunked = false, expect = false, length = 10000, prefix = '{', extra = {} } = {}) {
  const connection = await connect();
  connection.socket.write(headers(method, path, {
    ...(chunked ? { 'Transfer-Encoding': 'chunked' } : { 'Content-Length': length }),
    ...(expect ? { Expect: '100-continue' } : {}), ...extra,
  }) + (expect ? '' : chunked ? `${length.toString(16)}\r\n${prefix}` : prefix));
  return connection;
}
async function request(path, { method = 'GET', body, status = 200, timeout = 750 } = {}) {
  const started = performance.now();
  const response = await fetch(base + path, { method, signal: AbortSignal.timeout(timeout),
    headers: { Connection: 'close', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
  const text = await response.text();
  assert.equal(response.status, status, `${method} ${path}: ${text.slice(0, 100)}`);
  assert.ok(performance.now() - started < timeout, `${method} ${path} exceeded ${timeout} ms`);
  return text;
}
async function config() { return JSON.parse(await request('/config')); }
async function healthy(label) {
  const started = performance.now();
  try {
    await Promise.all(['/config-public', '/config', '/health', '/fonts/barlow-semi-condensed-600.woff2']
      .map(path => request(path)));
  } catch (error) { throw new Error(`${label}: normal HTTP workers blocked by incomplete uploads`, { cause: error }); }
  console.log(`${label}: four normal endpoints completed in ${(performance.now() - started).toFixed(1)} ms.`);
}
async function release(connections) {
  for (const connection of connections) connection.socket.destroy();
  await until(() => connections.every(connection => connection.closed), 750, 'Test sockets did not close');
  // Allow queued EOFs to be rejected before the next independent upload scenario.
  await pause(50);
}
async function unchanged(expected) {
  const current = await config();
  assert.equal(current.settings.stationName, expected.settings.stationName, 'Rejected body changed persisted settings');
  assert.equal(current._rev, expected._rev, 'Rejected body incremented the settings revision');
}
try {
  // No coordinates, cloud token, pulled source, MQTT or webhook: this test stays local.
  await writeFile(join(dir, 'config.json'), JSON.stringify({ settings: {
    httpPort: port, legacyLanAccess: true, stationSource: 'ecowitt', stationId: 'A',
    stationName: marker, token: '', rules: [], ecowittAppKey: 'fake-test-key', ecowittApiKey: 'fake-test-api',
  } }));
  child = spawn(binary, ['--headless'], { cwd: root, env: { ...process.env, WD_DATA_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
  closed = new Promise(resolve => child.once('close', resolve));
  let startupError;
  child.once('error', error => { startupError = error; });
  child.stdout.on('data', chunk => { output = (output + chunk).slice(-16000); });
  child.stderr.on('data', chunk => { output = (output + chunk).slice(-16000); });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (startupError) throw startupError;
    if (child.exitCode != null) throw new Error('Test server exited: ' + output);
    try { if ((await config()).settings.stationName === marker) { ready = true; break; } } catch {}
    await pause(50);
  }
  assert.ok(ready, 'Isolated server did not start: ' + output);

  // Six open PUTs exceed two active upload workers plus the bounded two-request queue.
  const held = [];
  for (const options of [{}, { chunked: true }, { expect: true }, { chunked: true, expect: true }, {}, {}]) {
    held.push(await stalled(options));
  }
  await pause(50);
  await healthy('Six stalled PUTs (fixed, chunked and Expect)');
  await until(() => held.filter(connection => connection.closed).length >= 2, 750,
    'Saturated uploads must close overflow connections, not queue them without a bound');
  assert.ok(held.filter(connection => !connection.closed).length <= 4);
  await release(held);

  // Even handlers which never consume the body must not drain it on the normal worker pool.
  const ignored = [await stalled({ method: 'GET', path: '/config-public' }),
    await stalled({ extra: { Origin: 'https://untrusted.example' } }),
    await stalled({ method: 'POST', path: '/archive/replace' }), await stalled({ chunked: true })];
  await pause(50);
  await healthy('GET, unauthorized and archive bodies');
  await release(ignored);
  await assert.rejects(access(join(dir, 'pre-station-replacement.wdbak')), 'Partial archive confirmation must not run replacement');

  // Confirmation is valid JSON but not a complete HTTP body. Reading it must happen before
  // acquiring the archive/configuration lock, and EOF must never accept its valid prefix.
  const archive = await stalled({ method: 'POST', path: '/archive/replace', length: 512, prefix: '{"confirm":"REPLACE"}' });
  await pause(50);
  const beforeArchive = await config();
  await Promise.all([request('/history/review'), request('/config', { method: 'PUT', body: {
    _rev: beforeArchive._rev || 0, settings: { stationName: beforeArchive.settings.stationName },
  } })]);
  assert.equal(archive.closed, false, 'Archive confirmation must remain incomplete during lock checks');
  await release([archive]);
  await assert.rejects(access(join(dir, 'pre-station-replacement.wdbak')), 'Truncated confirmation replaced the archive');

  // A complete JSON prefix is still invalid if its declared HTTP body is incomplete.
  for (const chunked of [false, true]) {
    const before = await config();
    const body = JSON.stringify({ _rev: before._rev || 0, settings: { stationName: 'must-not-persist' } });
    const connection = await connect();
    connection.socket.end(headers('PUT', '/config', chunked ? { 'Transfer-Encoding': 'chunked' } : { 'Content-Length': Buffer.byteLength(body) + 20 }) +
      (chunked ? `${Buffer.byteLength(body).toString(16)}\r\n${body}\r\n` : body));
    await until(() => connection.closed, 1500, 'Truncated HTTP body was not rejected');
    assert.doesNotMatch(connection.text, /HTTP\/1\.1 20[04]/, 'Truncated JSON prefix was accepted');
    await unchanged(before);
  }

  for (const [path, limit] of [['/config', 256 * 1024], ['/ingest', 64 * 1024]]) {
    const before = await config();
    const connection = await connect();
    connection.socket.write(headers(path === '/config' ? 'PUT' : 'POST', path, { 'Content-Length': limit + 1 }) + '{');
    await until(() => connection.closed, 750, 'Oversized Content-Length must be rejected without reading its body');
    await unchanged(before);
  }
  const beforeLargeChunk = await config();
  const largeBody = JSON.stringify({ _rev: beforeLargeChunk._rev || 0, settings: { stationName: 'oversized-prefix' } }).padEnd(256 * 1024 + 1, ' ');
  const largeChunk = await connect();
  largeChunk.socket.end(headers('PUT', '/config', { 'Transfer-Encoding': 'chunked' }) + `${largeBody.length.toString(16)}\r\n${largeBody}\r\n0\r\n\r\n`);
  await until(() => largeChunk.closed, 1500, 'Oversized chunked body was not rejected');
  await unchanged(beforeLargeChunk);

  // Preserve valid JSON, chunked uploads, 100-continue, and a second request on the same socket.
  let current = await config();
  await request('/config', { method: 'PUT', body: { _rev: current._rev || 0, settings: { stationName: marker + '-json' } } });
  current = await config();
  const chunkBody = JSON.stringify({ _rev: current._rev, settings: { stationName: marker + '-chunked' } });
  const validChunk = await connect();
  validChunk.socket.write(headers('PUT', '/config', { 'Transfer-Encoding': 'chunked', Expect: '100-continue', Connection: 'keep-alive' }));
  await until(() => /HTTP\/1\.1 100 Continue/.test(validChunk.text), 750, 'Valid upload did not receive 100 Continue');
  const split = Math.floor(chunkBody.length / 2);
  for (const chunk of [chunkBody.slice(0, split), chunkBody.slice(split)]) validChunk.socket.write(`${chunk.length.toString(16)}\r\n${chunk}\r\n`);
  validChunk.socket.write('0\r\n\r\n');
  await until(() => /HTTP\/1\.1 200/.test(validChunk.text) && validChunk.text.includes(marker + '-chunked'), 750, 'Valid chunked JSON upload failed');
  validChunk.socket.write(headers('GET', '/config-public', { Connection: 'close' }));
  await until(() => (validChunk.text.match(/HTTP\/1\.1 200/g) || []).length === 2, 750, 'Upload broke the next keep-alive request');
  validChunk.socket.destroy();
  assert.equal((await config()).settings.stationName, marker + '-chunked');
  assert.equal(await request('/ingest', { method: 'POST', body: 'ID=A&tempf=68&humidity=40' }), 'success');
  console.log('Truncated/oversized bodies rejected without writes; JSON, chunked, ingest, Expect and keep-alive preserved.');

  // A valid streamed backup still stages successfully. Failed or HTTP-truncated uploads
  // must remove their temporary bundle, even when the supplied prefix is a complete backup.
  const backupResponse = await fetch(base + '/backup.wdbak', { signal: AbortSignal.timeout(5000) });
  assert.equal(backupResponse.status, 200);
  const backup = Buffer.from(await backupResponse.arrayBuffer());
  assert.ok(backup.length > 0);
  const inspectedResponse = await fetch(base + '/restore/inspect', { method: 'POST', body: backup, signal: AbortSignal.timeout(5000) });
  assert.equal(inspectedResponse.status, 200);
  const inspected = await inspectedResponse.json();
  assert.equal(inspected.ok, true);
  await access(join(dir, `restore-${inspected.id}.wdbak`));
  const staged = async () => (await readdir(dir)).filter(name => /^restore-.*\.wdbak$/.test(name)).sort();
  const existingStages = await staged();
  for (const [body, missing] of [[Buffer.from('invalid backup'), 0], [backup, 20]]) {
    const connection = await connect();
    connection.socket.end(Buffer.concat([Buffer.from(headers('POST', '/restore/inspect', { 'Content-Length': body.length + missing })), body]));
    await until(() => connection.closed, 1500, 'Failed restore upload did not close');
    assert.doesNotMatch(connection.text, /"ok"\s*:\s*true/, 'Truncated or invalid backup was staged');
    assert.deepEqual(await staged(), existingStages, 'Failed restore left a temporary bundle behind');
  }
  console.log('Valid backup inspect preserved; invalid and complete-prefix/truncated restores cleaned up.');

  // An idle client expires after 10 s; a trickle cannot extend the absolute 30 s deadline.
  const events = await connect();
  events.socket.write(headers('GET', '/events'));
  await until(() => events.text.includes('text/event-stream'), 750, 'SSE stream did not open');
  const idle = await stalled(), trickle = await stalled();
  const started = performance.now();
  trickleTimer = setInterval(() => { if (!trickle.closed) trickle.socket.write(' '); }, 250);
  await healthy('Idle and trickling uploads');
  await until(() => idle.closed, 12500, 'Idle body exceeded its 10-second read timeout');
  const idleMs = performance.now() - started;
  await until(() => trickle.closed, Math.max(1, 32500 - idleMs), 'Trickling body exceeded its 30-second absolute deadline');
  clearInterval(trickleTimer);
  console.log(`Body deadlines: idle ${(idleMs / 1000).toFixed(1)} s; trickle ${((performance.now() - started) / 1000).toFixed(1)} s.`);
  await healthy('After expired uploads');
  assert.equal(events.closed, false, 'Body deadlines disconnected a long-lived SSE response');
  assert.ok(events.text.includes(': ping'), 'SSE heartbeat did not survive the 10-second body idle timeout');
  current = await config();
  await request('/config', { method: 'PUT', body: { _rev: current._rev, settings: { stationName: marker + '-recovered' } } });
  assert.equal((await config()).settings.stationName, marker + '-recovered');
  await until(() => events.text.includes('event: config'), 750, 'SSE did not deliver config changes after upload deadlines expired');
  events.socket.destroy();
  console.log('Upload isolation regression checks passed.');
} finally {
  clearInterval(trickleTimer);
  for (const socket of sockets) socket.destroy();
  if (child) {
    child.kill('SIGTERM');
    await Promise.race([closed, pause(3000)]);
    if (child.exitCode == null && child.signalCode == null) { child.kill('SIGKILL'); await closed; }
  }
  await rm(dir, { recursive: true, force: true });
}
