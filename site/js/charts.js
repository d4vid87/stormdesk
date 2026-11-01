// Minimal canvas chart helper.
// series: [{data:[{x,y}], color, type:'line'|'bar'|'band'}] — a band takes {x,lo,hi} instead
// and shades between them, which is what an ensemble spread is.
// Canvas can't read CSS variables, so the theme has to be handed to it. Read per draw: a chart
// is redrawn whenever anything changes, and a cached palette would be the one thing still dark
// after a switch to the light theme.
// One style read per draw, not one per colour: getComputedStyle forces style recalc, and the
// hover path redraws on every pointer frame.
const readCss = () => {
  const s = getComputedStyle(document.documentElement);
  const v = (n, f) => s.getPropertyValue(n).trim() || f;
  return { MUTED: v('--muted', '#8ea0b5'), LINE: v('--line', '#253141'),
    PANEL2: v('--panel2', '#111820'), TEXT: v('--text', '#e8eef6') };
};

let chartReadoutId = 0;

export function chart(canvas, series, opts = {}) {
  const { MUTED, LINE, PANEL2, TEXT } = readCss();
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 300, h = canvas.clientHeight || 140;
  // Assigning width/height reallocates the backing store and clears it even when the size did
  // not change — which is every hover frame.
  const cw = Math.round(w * dpr), ch = Math.round(h * dpr);
  const c = canvas.getContext('2d');
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);

  bindHover(canvas, series, opts);
  accessibleChart(canvas, series, opts);
  const pts = series
    .flatMap((s) => (s.type === 'band' ? s.data.flatMap((p) => [{ x: p.x, y: p.lo }, { x: p.x, y: p.hi }]) : s.data))
    .filter((p) => p.y != null && !Number.isNaN(p.y));
  if (!pts.length) {
    canvas._wdNearest = () => [];
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `${opts.label || 'Chart'}: no data`);
    c.fillStyle = MUTED; c.font = '12px system-ui';
    c.fillText('no data', 8, h / 2);
    return;
  }
  const padL = 34, padB = 16, padT = 8, padR = 6;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = opts.yMin ?? Math.min(...ys), y1 = opts.yMax ?? Math.max(...ys);
  if (y1 === y0) y1 = y0 + 1;
  const pad = (y1 - y0) * 0.1; y0 -= pad; y1 += pad;
  const px = (x) => padL + ((x - x0) / (x1 - x0 || 1)) * (w - padL - padR);
  const py = (y) => padT + (1 - (y - y0) / (y1 - y0)) * (h - padT - padB);

  // gridlines + y labels
  c.strokeStyle = LINE; c.fillStyle = MUTED; c.font = '10px system-ui'; c.lineWidth = 1;
  for (let i = 0; i <= 3; i++) {
    const y = y0 + ((y1 - y0) * i) / 3, yy = Math.round(py(y)) + 0.5;
    c.beginPath(); c.moveTo(padL, yy); c.lineTo(w - padR, yy); c.stroke();
    c.fillText(y.toFixed(opts.digits ?? 0), 2, yy + 3);
  }

  for (const s of series) {
    if (s.type === 'band') {
      const data = s.data.filter((p) => p.lo != null && p.hi != null);
      if (!data.length) continue;
      c.fillStyle = s.color;
      c.globalAlpha = s.alpha ?? 0.18;
      c.beginPath();
      data.forEach((p, i) => (i ? c.lineTo(px(p.x), py(p.hi)) : c.moveTo(px(p.x), py(p.hi))));
      for (let i = data.length - 1; i >= 0; i--) c.lineTo(px(data[i].x), py(data[i].lo));
      c.closePath();
      c.fill();
      c.globalAlpha = 1;
      continue;
    }
    const data = s.data.filter((p) => p.y != null && !Number.isNaN(p.y));
    if (!data.length) continue;
    if (s.dash) c.setLineDash(s.dash);
    if (s.type === 'bar') {
      const bw = Math.max(2, (w - padL - padR) / data.length - 2);
      c.fillStyle = s.color;
      for (const p of data) c.fillRect(px(p.x) - bw / 2, py(Math.max(p.y, 0)), bw, py(Math.min(y0, 0)) - py(Math.max(p.y, 0)));
    } else {
      c.strokeStyle = s.color; c.lineWidth = s.width || 1.6;
      c.beginPath();
      data.forEach((p, i) => (i ? c.lineTo(px(p.x), py(p.y)) : c.moveTo(px(p.x), py(p.y))));
      c.stroke();
    }
    c.setLineDash([]);
  }

  // x labels: first + last
  c.fillStyle = MUTED;
  const fmt = opts.xFormat || ((x) => new Date(x).toLocaleDateString([], { month: 'numeric', day: 'numeric' }));
  c.fillText(fmt(x0), padL, h - 4);
  const last = fmt(x1);
  c.fillText(last, w - padR - c.measureText(last).width, h - 4);

  // A chart is a picture to a screen reader unless it says so; the range is the part someone
  // listening actually wants.
  canvas.setAttribute('role', 'img');
  canvas.setAttribute(
    'aria-label',
    `${opts.label || 'chart'}: ${Math.min(...ys).toFixed(opts.digits ?? 0)} to ${Math.max(...ys).toFixed(opts.digits ?? 0)}${
      opts.unit ? ` ${opts.unit}` : ''}, ${fmt(x0)} to ${fmt(x1)}`
  );

  if (canvas._wdHover != null) crosshair(c, canvas._wdHover);
  // A time the caller wants marked whatever the pointer is doing — the detail panel opens on the
  // point that was clicked and has to show which one that was.
  else if (canvas._wdKeyX != null) {
    c.strokeStyle = TEXT; c.beginPath();
    c.moveTo(px(canvas._wdKeyX), padT); c.lineTo(px(canvas._wdKeyX), h - padB); c.stroke();
  }
  else if (opts.markX != null) crosshair(c, px(opts.markX));

  // The nearest real sample on each line to a pixel x, or [] when the pointer is nowhere near
  // one. Shared by the crosshair and the click handler so both agree on what was picked.
  function nearest(hx, hy) {
    if (Number.isFinite(hy) && (hx < padL || hx > w - padR || hy < padT || hy > h - padB)) return [];
    const marks = [];
    for (const s of series) {
      if (s.type === 'band') continue;
      let best = null, previous = null, distance = Infinity;
      const data = s.data.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
      for (const p of data) {
        const x = px(p.x), y = py(p.y), d = Math.abs(x - hx);
        if (!best || d < best.d) best = { d, p };
        if (Number.isFinite(hy)) {
          if (s.type === 'bar') {
            const half = Math.max(2, (w - padL - padR) / data.length - 2) / 2;
            const bottom = py(Math.min(y0, 0));
            distance = Math.min(distance, Math.hypot(Math.max(0, d - half), Math.max(y - hy, hy - bottom, 0)));
          } else {
            distance = Math.min(distance, Math.hypot(x - hx, y - hy));
            if (previous) {
              const dx = x - previous.x, dy = y - previous.y;
              const along = Math.max(0, Math.min(1, ((hx - previous.x) * dx + (hy - previous.y) * dy) / (dx * dx + dy * dy || 1)));
              distance = Math.min(distance, Math.hypot(hx - previous.x - along * dx, hy - previous.y - along * dy));
            }
          }
        }
        previous = { x, y };
      }
      if (best && (best.d < (w - padL - padR) / 4 || distance <= 12)) marks.push({ p: best.p, color: s.color, name: s.name, distance });
    }
    // Hit-test the drawn line, but always return a real observation for details.
    return Number.isFinite(hy) ? marks.sort((a, b) => a.distance - b.distance) : marks;
  }
  canvas._wdNearest = nearest;

  // The readout under the pointer: nearest real sample on each line, not an interpolation —
  // a chart that invents a value between two readings is a chart that lies.
  function crosshair(c, hx) {
    const marks = nearest(hx, canvas._wdHover == null ? undefined : canvas._wdHoverY);
    if (!marks.length) return;
    const gx = px(marks[0].p.x);
    c.strokeStyle = MUTED; c.lineWidth = 1;
    c.beginPath(); c.moveTo(gx + 0.5, padT); c.lineTo(gx + 0.5, h - padB); c.stroke();
    const lines = marks.map((m) => `${m.name ? `${m.name} ` : ''}${(+m.p.y).toFixed(opts.digits ?? 1)}${opts.unit || ''}`);
    const stamp = (opts.hoverFormat || fmt)(marks[0].p.x);
    for (const m of marks) {
      c.fillStyle = m.color;
      c.beginPath(); c.arc(px(m.p.x), py(m.p.y), 3, 0, Math.PI * 2); c.fill();
    }
    c.font = '11px system-ui';
    const text = `${stamp}  ${lines.join('  ')}`;
    const tw = c.measureText(text).width + 8;
    const tx = Math.min(Math.max(gx - tw / 2, padL), w - padR - tw);
    c.fillStyle = PANEL2;
    c.fillRect(tx, padT, tw, 16);
    c.strokeStyle = LINE; c.strokeRect(tx + 0.5, padT + 0.5, tw, 16);
    c.fillStyle = TEXT;
    c.fillText(text, tx + 4, padT + 12);
  }
}

/// Hover once, redraw forever: the listeners are attached to the canvas the first time it is
// drawn and just re-run the last draw with a pointer position on it. Pointer events rather than
// mouse events so a tablet gets the same readout from a fingertip.
function bindHover(canvas, series, opts) {
  canvas._wdDraw = () => chart(canvas, series, opts);
  // The listeners below are bound once, but the explorer redraws the same canvas with a different
  // `onPick` per metric — so the click reads the latest opts, not the ones it was bound with.
  canvas._wdOpts = opts;
  canvas.style.cursor = opts.onPick ? 'pointer' : '';
  if (canvas._wdBound || opts.hover === false) return;
  canvas._wdBound = true;
  // One redraw per frame however fast the pointer reports.
  let raf = 0;
  const move = (e) => {
    const rect = canvas.getBoundingClientRect();
    canvas._wdHover = e.clientX - rect.left;
    canvas._wdHoverY = e.clientY - rect.top;
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; canvas._wdDraw(); });
  };
  const clear = () => {
    if (canvas._wdHover == null) return;
    canvas._wdHover = null;
    canvas._wdHoverY = null;
    canvas._wdDraw();
  };
  // A click is a hover that stopped: `move` has already run, so the pick is whatever the readout
  // is showing. Nothing to do on a chart nobody wired an `onPick` to.
  canvas.addEventListener('click', (e) => {
    const onPick = canvas._wdOpts?.onPick;
    if (!onPick) return;
    const rect = canvas.getBoundingClientRect();
    const m = canvas._wdNearest?.(e.clientX - rect.left, e.clientY - rect.top)?.[0];
    if (m) onPick(m.p, m.name);
  });
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerdown', move);
  canvas.addEventListener('pointerleave', clear);
  canvas.addEventListener('pointercancel', clear);
  // Drawn while its panel was hidden, or resized after: the bitmap keeps whatever size it was
  // baked at (the `|| 300` fallback) until something redraws it.
  if ('ResizeObserver' in window) {
    let first = true;
    new ResizeObserver(() => {
      if (first) { first = false; return; }
      canvas._wdDraw();
    }).observe(canvas);
  }
}

function accessibleChart(canvas, series, opts) {
  let state = canvas._wdAccessible;
  if (!state) {
    const root = document.createElement('div');
    root.className = 'chart-accessibility';
    const live = document.createElement('p');
    live.id = 'wd-chart-readout-' + ++chartReadoutId;
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    live.style.fontSize = '13px';
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Chart data and keyboard help';
    const help = document.createElement('p');
    help.textContent = 'Focus the chart: Left/Right move through readings; Up/Down change series; Home/End select first/last. Enter opens reading details when available.';
    const table = document.createElement('table');
    table.style.width = '100%';
    const scroll = document.createElement('div');
    scroll.style.overflowX = 'auto';
    scroll.append(table);
    const previous = document.createElement('button'), next = document.createElement('button');
    previous.type = next.type = 'button';
    previous.textContent = 'Previous 100 readings'; next.textContent = 'Next 100 readings';
    const page = document.createElement('p');
    page.setAttribute('role', 'status');
    details.append(summary, help, scroll, previous, next, page);
    root.append(live, details);
    state = canvas._wdAccessible = { root, live, details, summary, table, previous, next, page, groups: [], rows: [], offset: 0, group: 0, point: -1 };
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-describedby', live.id);
    details.addEventListener('toggle', () => { if (details.open) renderChartTable(canvas); });
    previous.onclick = () => { state.offset = Math.max(0, state.offset - 100); renderChartTable(canvas); };
    next.onclick = () => { state.offset += 100; renderChartTable(canvas); };
    canvas.addEventListener('focus', () => {
      if (state.point < 0) state.live.textContent = state.rows.length
        ? 'Use arrow keys to explore readings. Chart data and keyboard help follows this chart.'
        : 'No chart data available.';
    });
    canvas.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter'].includes(event.key) || !state.groups.length) return;
      event.preventDefault();
      if (event.key === 'Enter') {
        const group = state.groups[state.group], point = group.data[state.point];
        if (point) canvas._wdOpts?.onPick?.(point, group.series.name);
        return;
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        state.group = (state.group + (event.key === 'ArrowUp' ? -1 : 1) + state.groups.length) % state.groups.length;
      }
      const group = state.groups[state.group];
      if (event.key === 'Home') state.point = 0;
      else if (event.key === 'End') state.point = group.data.length - 1;
      else if (event.key === 'ArrowRight') state.point++;
      else if (event.key === 'ArrowLeft') state.point--;
      state.point = Math.max(0, Math.min(group.data.length - 1, state.point));
      const point = group.data[state.point];
      canvas._wdKeyX = point.x;
      canvas._wdHover = null;
      state.live.textContent = chartReading(group.series, point, canvas._wdOpts);
      canvas._wdDraw();
    });
    canvas.addEventListener('blur', () => { canvas._wdKeyX = null; canvas._wdDraw(); });
  }
  if (canvas.parentNode && state.root.parentNode !== canvas.parentNode) canvas.after(state.root);
  // Pointer frames keep the same series: never rebuild the table or its row index on hover.
  if (state.series === series && state.label === opts.label && state.unit === opts.unit && state.digits === opts.digits) return;
  state.series = series; state.label = opts.label; state.unit = opts.unit; state.digits = opts.digits;
  state.groups = series.map(s => ({ series: s, data: s.data.filter(p => Number.isFinite(p.x)
    && (s.type === 'band' ? Number.isFinite(p.lo) && Number.isFinite(p.hi) : Number.isFinite(p.y))) })).filter(s => s.data.length);
  state.rows = state.groups.flatMap(group => group.data.map(point => ({ series: group.series, point })));
  state.offset = 0; state.group = 0; state.point = -1;
  canvas._wdKeyX = null;
  state.live.textContent = state.rows.length ? '' : 'No chart data available.';
  state.summary.textContent = (opts.label || 'Chart') + ': data and keyboard help';
  if (state.details.open) renderChartTable(canvas);
  else { state.table.replaceChildren(); state.page.textContent = ''; }
}

function chartReading(series, point, opts = {}) {
  const time = point.sourceX ?? point.x;
  const stamp = (opts.hoverFormat || opts.xFormat || (x => new Date(x).toLocaleString()))(time);
  const value = series.type === 'band'
    ? point.lo.toFixed(opts.digits ?? 1) + ' to ' + point.hi.toFixed(opts.digits ?? 1)
    : point.y.toFixed(opts.digits ?? 1);
  return [series.name || opts.label || 'Reading', stamp, value + (opts.unit ? ' ' + opts.unit : '')].join(' · ');
}

function renderChartTable(canvas) {
  const state = canvas._wdAccessible;
  const opts = canvas._wdOpts || {};
  state.table.replaceChildren();
  const caption = document.createElement('caption');
  caption.textContent = (opts.label || 'Chart') + ' readings (original observation times)';
  const head = state.table.createTHead().insertRow();
  for (const label of ['Series', 'Time', 'Value', 'Lower bound', 'Upper bound']) {
    const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = label; head.append(cell);
  }
  state.table.prepend(caption);
  const body = state.table.createTBody();
  for (const { series, point } of state.rows.slice(state.offset, state.offset + 100)) {
    const row = body.insertRow(), time = point.sourceX ?? point.x;
    const format = value => Number.isFinite(value) ? value.toFixed(opts.digits ?? 1) + (opts.unit ? ' ' + opts.unit : '') : '—';
    const stamp = (opts.hoverFormat || opts.xFormat || (x => new Date(x).toLocaleString()))(time);
    [series.name || opts.label || 'Reading', stamp, format(point.y), format(point.lo), format(point.hi)]
      .forEach(value => { const cell = row.insertCell(); cell.textContent = value; });
  }
  state.previous.disabled = state.offset === 0;
  state.next.disabled = state.offset + 100 >= state.rows.length;
  state.page.textContent = state.rows.length
    ? 'Readings ' + (state.offset + 1) + '–' + Math.min(state.offset + 100, state.rows.length) + ' of ' + state.rows.length
    : 'No chart data available.';
}

if (typeof window !== 'undefined' && location.search.includes('selftest')) {
  const cv = document.createElement('canvas');
  cv.width = 200; cv.height = 100;
  chart(cv, [{ data: [{ x: 0, y: 1 }, { x: 1, y: 5 }], color: '#f00' }], { label: 'test', unit: '°' });
  console.assert(cv.toDataURL().length > 100, 'chart self-check failed');
  console.assert(/test: 1 to 5 °/.test(cv.getAttribute('aria-label')), 'chart: aria-label describes the range');
  const before = cv.toDataURL();
  // Over the first sample, which is at the left padding — far enough from the second that the
  // readout picks one.
  cv._wdHover = 36;
  chart(cv, [{ data: [{ x: 0, y: 1 }, { x: 1, y: 5 }], color: '#f00' }], { label: 'test' });
  console.assert(cv.toDataURL() !== before, 'chart: hover draws a crosshair');
  // Click to pick: the handler reads the same nearest-sample map the readout draws with.
  {
    const cv2 = document.createElement('canvas');
    cv2.width = 200; cv2.height = 100;
    let picked = null;
    chart(cv2, [{ data: [{ x: 0, y: 1 }, { x: 100, y: 5 }], color: '#f00', name: 'a' }],
      { onPick: (p, name) => { picked = { p, name }; } });
    cv2._wdNearest = (hx) => (hx < 50 ? [{ p: { x: 0, y: 1 }, name: 'a' }] : []);
    cv2.dispatchEvent(new MouseEvent('click', { clientX: 4 }));
    console.assert(picked?.p.y === 1 && picked.name === 'a', 'chart: a click hands back the sample under it');
    picked = null;
    cv2.dispatchEvent(new MouseEvent('click', { clientX: 400 }));
    console.assert(picked === null, 'chart: a click nowhere near a sample picks nothing');
    // Redrawn without a pick: the old handler must not keep firing the old callback.
    chart(cv2, [{ data: [{ x: 0, y: 1 }], color: '#f00', name: 'a' }], {});
    cv2._wdNearest = () => [{ p: { x: 0, y: 1 }, name: 'a' }];
    cv2.dispatchEvent(new MouseEvent('click', { clientX: 4 }));
    console.assert(picked === null && cv2.style.cursor === '', 'chart: a redraw replaces the pick handler');
  }
  cv._wdHover = null;
  chart(cv, [{ type: 'band', data: [{ x: 0, lo: 1, hi: 9 }, { x: 1, lo: 2, hi: 8 }], color: '#0f0' }]);
  console.assert(/1 to 9/.test(cv.getAttribute('aria-label')), 'chart: a band sets the scale from lo and hi');
}
