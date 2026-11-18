// Tempest hub broadcasts on UDP 50222 — same wind and strike events the cloud websocket carries,
// only without the round trip and without needing the internet at all. Browsers can't hold a UDP
// socket, so the desktop app listens and re-serves the last packet per type at /udp; a plain
// browser install has no such route and this module switches itself off on the first miss.
import { every, num, expires, settings } from './app.js';
import { renderRapid, onStrike } from './signals.js';
import { stationContext, publishObservation } from './api.js';

// The app window runs on tauri://localhost, so it gets an absolute URL injected at build of the
// webview; the LAN tablet is same-origin with the server and uses the relative path.
const URL = window.__WD_UDP || '/udp';
const SRV = window.__WD_SRV || '';
const FRESH_SEC = 10;
// obs_st is a once-a-minute report, so the 10s window that suits 3s rapid_wind would reject
// every one of them.
const OBS_FRESH_SEC = 120;

let misses = 0, off = false, slow = false, streaming = false;
let hostContext = null, hostRevision = null;
function localFeedContext(snapshot = settings()) {
  if (!window.__WD_PUBLIC && !document.body?.classList?.contains('public')) return stationContext(snapshot);
  // Viewer bootstrap removes secrets; old browser storage can still contain one. Only viewers
  // ignore those fields. For editors an ingest key may identify a different station/archive.
  const visible = { ...snapshot };
  for (const key of ['token', 'lacrossePass', 'ecowittApiKey', 'ecowittAppKey', 'ingestKey', 'awnApiKey', 'awnAppKey']) visible[key] = '';
  return stationContext(visible);
}
// A local selection is optimistic until /config accepts it. Foreign-brand packets have no
// device id, so accepting them during the PUT could attribute the old host's weather to the
// new station. Keep config events flowing while weather waits for the matching host snapshot.
window.addEventListener('wd:host-config', e => {
  const context = e.detail ? localFeedContext(e.detail) : null;
  const revision = Number.isFinite(e.detail?._rev) ? e.detail._rev : null;
  const changed = context !== hostContext || revision !== hostRevision;
  hostContext = context; hostRevision = revision;
  // A packet queued by the pre-ack connection can reach JS after the HTTP acknowledgement.
  // Start a new stream at that boundary so its old callbacks cannot masquerade as new data.
  if (started && changed) stream();
});

const schedule = (sec) => every('udp', sec, poll);

async function poll() {
  // The stream delivers each packet the moment the hub sends it; polling on top of that is a
  // request every three seconds for something we already have.
  if (off || streaming || hostContext !== localFeedContext()) return;
  const context = stationContext();
  let j;
  try {
    const r = await fetch(URL, { signal: expires(3000) });
    if (!r.ok) throw new Error(r.status);
    j = await r.json();
    misses = 0;
    if (slow) { slow = false; schedule(3); }
  } catch {
    // Three strikes rather than one: a single hiccup on the loopback shouldn't cost the
    // rest of the session's local feed.
    if (++misses < 3) return;
    misses = 0;
    // A plain browser or the Android build has no /udp route at all and never will — switch off.
    // On the desktop the route exists, so a miss means the hub is unplugged or the app just
    // started: back off to a minute and keep looking, because the local feed is the only feed
    // in UDP-only mode.
    if (!window.__WD_UDP) off = true;
    else if (!slow) { slow = true; schedule(60); }
    return;
  }

  if (context === stationContext()) apply(j);
}

// One poll's worth of packets, keyed by type — which is also the shape of a single streamed
// packet, so both paths land here.
function apply(j) {
  if (hostContext !== localFeedContext()) return;
  const selected = settings();
  const owns = p => {
    if (!p) return false;
    if (!p.serial_number || !selected.deviceId) return true;
    if (selected.stationSource && selected.stationSource !== 'tempest') return false;
    // Headless hosts may resolve their selected serial after this screen bootstraps. Trust
    // their already-verified feed when local metadata is absent; never reuse an old binding.
    if (!selected.deviceSerial || String(selected.serialDeviceId) !== String(selected.deviceId)) {
      return !selected.deviceSerial || p.serial_number !== selected.deviceSerial;
    }
    return p.serial_number === selected.deviceSerial
      && (!selected.hubSerial || p.hub_sn === selected.hubSerial);
  };
  const now = Date.now() / 1000;
  const fresh = (p) => owns(p) && now - p._at < FRESH_SEC;

  const w = j.rapid_wind;
  if (fresh(w) && w.ob) {
    renderRapid(w.ob[1], w.ob[2]);
    const el = document.getElementById('ws-state');
    if (el) { el.textContent = 'live · local UDP'; el.className = 'ok'; }
  }

  const s = j.evt_strike;
  if (fresh(s) && s.evt) onStrike(s.evt);

  // Same SI tuple the cloud websocket sends, so it rides the same event — the hero, the gauges
  // and the MQTT publisher all get a local feed without a token. Dedupe by the report's own
  // timestamp: a 3s poll sees each minute-old report about twenty times.
  // The hub reports its own health every minute. No freshness gate: a status packet that has
  // stopped arriving is exactly what the health card needs to show, stamp and all.
  if (owns(j.device_status)) {
    window.dispatchEvent(new CustomEvent('wd:device-status', { detail: j.device_status }));
  }

  const o = j.obs_st;
  if (owns(o) && o.obs?.[0] && now - o._at < OBS_FRESH_SEC) {
    publishObservation(o.obs[0]);
  }
}

// Everything the server hears, pushed as it arrives: a gust shows up in the same second the hub
// broadcast it instead of up to three seconds later. The poll stays as the fallback — a static
// self-host has no /events route, and neither does a v2 desktop app on the LAN.
let es = null;
let streamContext = null, started = false;
function stream() {
  if (!('EventSource' in window)) return;
  try { es?.close(); } catch { /* already gone */ }
  es = null;
  streaming = false;
  streamContext = stationContext();
  try { es = new EventSource(`${SRV}/events`); } catch { return; }
  const source = es, context = streamContext;
  es.addEventListener('udp', (e) => {
    if (source !== es || context !== stationContext()) return;
    let p;
    try { p = JSON.parse(e.data); } catch { return; }
    if (!p?.type) return;
    streaming = true;
    apply({ [p.type]: p });
  });
  // The revision rides along: a screen that already holds it is the one that just wrote it, and
  // re-pulling its own write is how the config sync used to chase its own tail.
  es.addEventListener('config', (e) => {
    if (source !== es) return;
    let d = null;
    try { d = JSON.parse(e.data); } catch { /* older server sent no body */ }
    // Pause before the asynchronous config pull. An acknowledged own revision needs no pull
    // and must not leave the local feed paused after a successful save.
    if (hostRevision == null || !Number.isFinite(d?.rev) || d.rev > hostRevision) hostContext = null;
    window.dispatchEvent(new CustomEvent('wd:config-rev', { detail: d }));
  });
  // EventSource reconnects by itself; the poll covers the gap until a packet proves it back.
  es.onerror = () => { if (source === es) streaming = false; };
}
window.addEventListener('wd:settings', () => {
  if (started && stationContext() !== streamContext) stream();
});

export function initUdp() {
  started = true;
  schedule(slow ? 60 : 3);
  stream();
}

// ponytail-lite self-check alongside layout.js's: the freshness window is the only arithmetic here.
if (location.search.includes('selftest')) {
  const now = Date.now() / 1000;
  console.assert(now - (now - 3) < FRESH_SEC, 'udp: recent packet counts as fresh');
  console.assert(!(now - (now - 60) < FRESH_SEC), 'udp: minute-old packet is stale');
  console.assert(num(1.5, 1) === '1.5', 'udp: app.js helpers imported');
  console.assert(now - (now - 60) < OBS_FRESH_SEC, 'udp: minute-old obs_st still counts');
  console.assert(!(now - (now - 600) < OBS_FRESH_SEC), 'udp: ten-minute-old obs_st is stale');
  if ('EventSource' in window) {
    stream(); stream();
    console.assert(es && es.readyState !== 2, 'udp: a second stream() leaves exactly one open EventSource');
    es.close();
  }
}
