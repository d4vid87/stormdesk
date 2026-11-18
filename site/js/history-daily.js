import { stationContext } from './api.js';

// Offset remains for older hosts. IANA rules let upgraded hosts group winter and summer
// observations by their own local date instead of applying today's offset to the entire log.
export function historyTimezoneQuery() {
  const query = new URLSearchParams({ tz: -new Date().getTimezoneOffset() });
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone) query.set('tz_name', zone);
  } catch { /* old webviews retain the fixed-offset fallback */ }
  return query.toString();
}

const pending = new Map();
const abortError = () => new DOMException('Archive request cancelled', 'AbortError');
function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const stop = () => { clearTimeout(timer); reject(signal.reason || abortError()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, ms);
    if (signal.aborted) stop(); else signal.addEventListener('abort', stop, { once: true });
  });
}

async function fetchDaily(url, context, signal, deadline) {
  for (;;) {
    if (signal.aborted) throw signal.reason || abortError();
    if (context !== stationContext()) throw abortError();
    const response = await fetch(url, { cache: 'no-store', signal });
    const data = await response.json().catch(() => null);
    if (signal.aborted) throw signal.reason || abortError();
    if (context !== stationContext()) throw abortError();
    if (response.ok) {
      if (!Array.isArray(data)) throw Error(data?.error || 'Archive returned invalid daily records');
      return data;
    }
    const error = Error(data?.error || (response.status === 401
      ? 'Pair this screen to read the archive.' : `Archive request failed (${response.status})`));
    // Only the host's explicit "daily build busy" backoff is retried. Authentication and
    // missing-server failures retain their original behavior and are never silently emptied.
    const retry = response.headers.get('Retry-After');
    if (response.status !== 503 || !retry) throw error;
    const ms = /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now();
    const delay = Math.max(250, Number.isFinite(ms) ? ms : 1000);
    if (Date.now() + delay >= deadline) throw error;
    await wait(delay, signal);
  }
}

export function dailyHistory({ signal } = {}) {
  if (signal?.aborted) return Promise.reject(signal.reason || abortError());
  const context = stationContext();
  const url = `${window.__WD_SRV || ''}/history/daily?${historyTimezoneQuery()}`;
  const key = `${context}:${url}`;
  let entry = pending.get(key);
  if (!entry) {
    const controller = new AbortController(), deadline = Date.now() + 15000;
    const timeout = setTimeout(() => controller.abort(new DOMException('Archive request timed out (15s)', 'TimeoutError')), 15000);
    entry = { context, controller, readers: 0 };
    entry.promise = fetchDaily(url, context, controller.signal, deadline).finally(() => {
      clearTimeout(timeout);
      if (pending.get(key) === entry) pending.delete(key);
    });
    pending.set(key, entry);
  }
  entry.readers++;
  // One consumer closing a drawer must not cancel the Almanac's shared request. When the
  // last consumer leaves, stop both the fetch and any pending retry timer immediately.
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (error, data) => {
      if (done) return;
      done = true; signal?.removeEventListener('abort', cancel);
      if (--entry.readers === 0 && pending.get(key) === entry) {
        pending.delete(key); entry.controller.abort(abortError());
      }
      if (error) reject(error); else resolve(structuredClone(data));
    };
    const cancel = () => finish(signal.reason || abortError());
    signal?.addEventListener('abort', cancel, { once: true });
    entry.promise.then(data => finish(null, data), error => finish(error));
  });
}

window.addEventListener('wd:settings', () => {
  const current = stationContext();
  for (const [key, entry] of pending) if (entry.context !== current) {
    pending.delete(key); entry.controller.abort(abortError());
  }
});
window.addEventListener('wd:archive-change', () => {
  for (const entry of pending.values()) entry.controller.abort(abortError());
  pending.clear();
});
