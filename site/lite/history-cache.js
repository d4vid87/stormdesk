// Small, bounded browser history for screens that have no continuously running host.
const KEY = 'wd.liteHistory.v1';
const WEEK = 7 * 86400;
const BUCKET = 900;

export function historyContext(s, point) {
  return JSON.stringify([s.stationId || '', s.stationSource || '', s.activePlace || '', point.lat, point.lon]);
}

export function recentHistory(context) {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    return saved?.context === context && Array.isArray(saved.rows) ? saved.rows : [];
  } catch { return []; }
}

export function rememberHistory(context, row) {
  if (!Number.isFinite(row?.time) || row.time <= 0) return;
  if (![row.tempC, row.windMs, row.rainMm].some(Number.isFinite)) return;
  const rows = recentHistory(context);
  const bucket = Math.floor(row.time / BUCKET);
  if (rows.length && Math.floor(rows[rows.length - 1].time / BUCKET) === bucket) return;
  rows.push(row);
  const cutoff = Date.now() / 1000 - WEEK;
  const kept = rows.filter((item) => item.time >= cutoff).slice(-672);
  try { localStorage.setItem(KEY, JSON.stringify({ context, rows: kept })); }
  catch { /* Private browsing and full storage still leave the live page usable. */ }
}
