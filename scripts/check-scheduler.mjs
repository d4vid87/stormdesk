import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../site/js/app.js', import.meta.url), 'utf8');
const jobs = new Map(), timers = new Map(), listeners = {};
const document = { hidden: false, addEventListener: (name, fn) => { listeners[name] = fn; } };
let nextTimer = 0;
const context = vm.createContext({
  jobs, document, console, queueMicrotask, paceFor: (_, seconds) => seconds,
  window: {}, innerHeight: 900,
  setInterval: (fn) => { timers.set(++nextTimer, fn); return nextTimer; },
  clearInterval: (id) => timers.delete(id),
});
vm.runInContext([
  source.slice(source.indexOf('export function every('), source.indexOf('// The night window')),
  source.slice(source.indexOf('export function clearJob('), source.indexOf('// --- freshness stamps')),
].join('\n').replace(/^export /gm, ''), context);
const { every, clearJob } = context;
const flush = () => new Promise(setImmediate);
let calls = 0, finish;
const slow = () => { calls++; return new Promise(resolve => { finish = resolve; }); };

every('slow', 1, slow);
const tick = timers.get(jobs.get('slow').id);
tick(); tick(); tick();
assert.equal(calls, 1, 'slow requests never overlap');
finish(); await flush();
assert.equal(calls, 1, 'missed ticks do not cause continuous catch-up polling');
tick();
assert.equal(calls, 2, 'the next scheduled tick still refreshes');
finish(); await flush();
clearJob('slow');

for (const action of ['remove', 'replace']) {
  every('pending', 1, slow);
  const oldRun = jobs.get('pending').run;
  const settle = finish;
  document.hidden = true;
  await oldRun();
  document.hidden = false;
  const before = calls;
  if (action === 'remove') clearJob('pending');
  else every('pending', 1, () => {});
  settle(); await flush();
  await oldRun();
  assert.equal(calls, before, `${action}: the retired job cannot run again`);
  clearJob('pending');
}

document.hidden = true;
calls = 0;
every('hidden', 1, slow);
await jobs.get('hidden').run();
assert.equal(calls, 0, 'hidden screens do no work');
document.hidden = false;
listeners.visibilitychange();
assert.equal(calls, 1, 'returning to the screen runs one pending refresh');
finish(); await flush();
assert.equal(calls, 1, 'resuming does not duplicate the refresh');
document.hidden = true;
await jobs.get('hidden').run();
document.hidden = false;
jobs.get('hidden').run();
listeners.visibilitychange();
finish(); await flush();
assert.equal(calls, 2, 'a timer firing before the visibility event also clears pending work');
clearJob('hidden');
let visible = false, visibleCalls = 0;
const element = { getClientRects: () => visible ? [1] : [], getBoundingClientRect: () => ({ top: 10, bottom: 100 }) };
context.everyVisible('visible', 60, element, () => { visibleCalls++; });
await flush();
assert.equal(visibleCalls, 0, 'closed analysis does not fetch');
visible = true; await jobs.get('visible').run();
assert.equal(visibleCalls, 1, 'opening analysis fetches once');
await jobs.get('visible').run();
assert.equal(visibleCalls, 1, 'visibility changes within a refresh window reuse data');
clearJob('visible');
assert.equal(timers.size, 0, 'clearing jobs releases their timers');
console.log('Scheduler: slow requests, cancelled/replaced jobs, hidden screens and resume passed.');
