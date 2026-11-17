import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';

const element = () => ({
  style: {}, attributes: new Map(), listeners: new Map(), children: [], textContent: '',
  setAttribute(name, value) { this.attributes.set(name, value); },
  getAttribute(name) { return this.attributes.get(name); },
  addEventListener(name, fn) { this.listeners.set(name, fn); },
  append(...nodes) { this.children.push(...nodes); },
  replaceChildren(...nodes) { this.children = nodes; },
});
const context = new Proxy({ measureText: () => ({ width: 10 }) }, { get: (target, key) => key in target ? target[key] : () => {} });
const canvas = Object.assign(element(), { width: 800, height: 200, clientWidth: 800, clientHeight: 200, getContext: () => context });
const sandbox = vm.createContext({
  window: { devicePixelRatio: 1 }, document: { documentElement: {}, createElement: element }, location: { search: '' },
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
});
vm.runInContext(readFileSync(new URL('../site/js/charts.js', import.meta.url), 'utf8').replace(/^export /gm, ''), sandbox);
const chart = sandbox.chart;
const data = Array.from({ length: 40320 }, (_, i) => ({ x: i, y: Math.sin(i / 100) * 20 }));
const series = Array.from({ length: 4 }, () => ({ data, color: '#fff' }));
chart(canvas, series, { label: 'History' });
assert.equal(canvas._wdPrepared.groups.length, 4);
assert.equal(canvas._wdPrepared.groups, canvas._wdAccessible.groups, 'drawing reuses the accessibility samples instead of retaining another copy');
assert.equal(canvas._wdAccessible.rows.length, 161280, 'all readings remain accessible');
const prepared = canvas._wdPrepared, rows = canvas._wdAccessible.rows;
canvas._wdHover = 400;
for (let i = 0; i < 4; i++) canvas._wdDraw();
assert.equal(canvas._wdPrepared, prepared, 'pointer frames reuse finite samples and bounds');
assert.equal(canvas._wdAccessible.rows, rows, 'pointer frames keep the accessibility index');
assert.equal(canvas._wdNearest(400)[0].p, data[Math.round((400 - 34) / (800 - 34 - 6) * (data.length - 1))], 'hover returns an original sample');

// Data updates use a fresh outer series array in every production caller.
data[0].y = 100;
chart(canvas, [...series], { label: 'Updated' });
assert.notEqual(canvas._wdPrepared, prepared);
assert.equal(canvas._wdPrepared.high, 100, 'new data invalidates the prepared snapshot');
assert.ok(canvas.getAttribute('aria-label').startsWith('Updated: -20 to 100'));
chart(canvas, [{ type: 'band', color: '#fff', data: [{ x: 0, lo: 9, hi: 1 }, { x: 1, lo: 2, hi: 8 }, { x: 2, lo: NaN, hi: 6 }] }]);
assert.equal(canvas._wdPrepared.low, 1); assert.equal(canvas._wdPrepared.high, 9);
assert.equal(canvas._wdPrepared.groups[0].data.length, 2, 'invalid band bounds are not rendered');
chart(canvas, [{ color: '#fff', data: [{ x: Infinity, y: 1 }, { x: 1, y: Infinity }, { x: 1, y: NaN }] }], { label: 'Invalid' });
assert.equal(canvas.getAttribute('aria-label'), 'Invalid: no data');
assert.equal(canvas._wdNearest(100).length, 0);

const week = data.slice(0, 10080), weeklySeries = Array.from({ length: 4 }, () => ({ data: week, color: '#fff' }));
chart(canvas, weeklySeries); canvas._wdHover = null;
const start = performance.now();
for (let i = 0; i < 20; i++) canvas._wdDraw();
console.log(`Chart performance: 161,280 points without argument overflow; cached hover, full accessible samples, fresh-series invalidation and finite bounds passed. Four-series 40,320-point no-op canvas benchmark: ${((performance.now() - start) / 20).toFixed(2)}ms/redraw (JavaScript only).`);
