import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../site/js/speech.js', import.meta.url), 'utf8');
const { createSpeech, shouldSpeak } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const warning = { id: 'warning', category: 'severe', title: 'Flood Warning', severity: 'Moderate', headline: 'Flooding expected', expires: 20000 };
const watch = { ...warning, id: 'watch', title: 'Tornado Watch' };
const on = { speakAlerts: true, notif: { severe: true } };
assert(shouldSpeak(warning, on));
assert(shouldSpeak(watch, on));
assert(!shouldSpeak({ ...warning, title: 'Dense Fog Advisory' }, on));
assert(shouldSpeak({ ...warning, title: 'Flood Advisory', headline: 'FLASH FLOOD EMERGENCY' }, on));
assert(!shouldSpeak(warning, { ...on, speakAlerts: false }));
assert(!shouldSpeak(warning, { ...on, notif: { severe: false } }));
assert(!shouldSpeak({ ...warning, category: 'info' }, on));

function harness(native, missing = false, preferNative = false) {
  let clock = 0, seq = 0;
  const timers = new Map(), utterances = [], states = [], s = structuredClone(on);
  const synth = { getVoices: () => [], speak: (u) => utterances.push(u), cancel() {}, paused: false };
  const controller = createSpeech({ synth: missing ? null : synth, Utterance: class { constructor(text) { this.text = text; } },
    native, preferNative: () => preferNative, settings: () => s, status: (v) => states.push(v), now: () => clock,
    later: (f, ms) => { timers.set(++seq, { f, at: clock + ms }); return seq; }, cancelTimer: (id) => timers.delete(id) });
  return { controller, utterances, states, s, synth,
    tick(ms) { clock += ms; for (const [id, t] of [...timers]) if (t.at <= clock && timers.delete(id)) t.f(); },
    end() { utterances.at(-1).onstart?.(); utterances.at(-1).onend?.(); },
    fail(error) { utterances.at(-1).onerror({ error }); },
  };
}
{
  const h = harness();
  h.controller.sync([watch, warning], 'home'); h.tick(300);
  assert.match(h.utterances[0].text, /^Flood Warning/);
  h.fail('not-allowed'); assert.equal(h.states.at(-1), 'Tap to enable');
  h.controller.sync([watch, warning], 'home'); h.tick(300); assert.equal(h.utterances.length, 1);
  h.controller.test(); assert.match(h.utterances.at(-1).text, /only a test/);
  h.end(); assert.match(h.utterances.at(-1).text, /^Flood Warning/);
  h.end(); assert.match(h.utterances.at(-1).text, /^Tornado Watch/); h.end();
  h.controller.sync([watch, warning], 'home'); h.tick(300); assert.equal(h.utterances.length, 4);
  h.controller.sync([{ ...warning, headline: 'FLASH FLOOD EMERGENCY' }, watch], 'home'); h.tick(300);
  assert.match(h.utterances.at(-1).text, /^Emergency/); h.end();
  h.controller.say('Your daily briefing.'); assert.equal(h.utterances.at(-1).text, 'Your daily briefing.'); h.end();
}
for (const mode of ['expires', 'disappears', 'location', 'disabled', 'channel']) {
  const h = harness();
  h.controller.sync([warning], 'home'); h.tick(300); h.fail('not-allowed');
  if (mode === 'expires') h.tick(21000);
  if (mode === 'disappears') h.controller.sync([], 'home');
  if (mode === 'location') h.controller.changed('away');
  if (mode === 'disabled') { h.s.speakAlerts = false; h.controller.changed('home'); }
  if (mode === 'channel') { h.s.notif.severe = false; h.controller.changed('home'); }
  h.controller.test(); h.end(); assert.equal(h.utterances.length, 2, mode);
}
{
  const h = harness(); h.s.speakAlerts = false;
  h.controller.sync([warning], 'home'); h.tick(300); assert.equal(h.utterances.length, 0);
  h.s.speakAlerts = true; h.controller.changed('home'); assert.equal(h.utterances.length, 1);
  h.tick(10000); assert.match(h.states.at(-1), /did not start/);
  h.controller.test(); h.end(); assert.equal(h.utterances.length, 3);
}
{
  const h = harness(); h.controller.test(); h.fail('voice-unavailable'); assert.match(h.states.at(-1), /Waiting for system voices/);
  h.synth.getVoices = () => [{ lang: 'en-US', default: true }]; h.controller.voicesChanged();
  assert.equal(h.utterances.at(-1).voice.lang, 'en-US'); h.end();
}
{
  const calls = [], h = harness(async (text) => calls.push(text), true);
  h.controller.sync([warning], 'home'); h.tick(300);
  await new Promise(setImmediate); assert.equal(calls.length, 1); assert.equal(h.states.at(-1), 'Ready');
  h.controller.sync([warning], 'home'); h.tick(300); assert.equal(calls.length, 1);
}
{
  const calls = [], h = harness(async (text) => calls.push(text));
  h.controller.test(); h.utterances[0].onstart(); h.fail('audio-hardware');
  await new Promise(setImmediate); assert.equal(calls.length, 0); assert.match(h.states.at(-1), /speakers/);
}
{
  const h = harness(async () => { throw new Error('Install espeak-ng'); }, true);
  h.controller.test(); await new Promise(setImmediate); assert.match(h.states.at(-1), /Install espeak-ng/);
}
console.log('Speech checks passed: eligibility, queue, retry, expiry, settings, escalation, voices, timeout, Linux fallback and briefings.');
{
  const calls = [], h = harness(async (text) => calls.push(text), false, true);
  h.controller.sync([watch, warning], 'home'); h.tick(300);
  await new Promise(setImmediate);
  assert.equal(h.utterances.length, 0, 'installed natural voice bypasses robotic browser speech');
  assert.equal(calls.length, 2);
  assert.match(calls[0], /^Flood Warning/);
  assert.match(calls[1], /^Tornado Watch/);
  h.controller.sync([watch, warning], 'home'); h.tick(300);
  await new Promise(setImmediate); assert.equal(calls.length, 2);
  console.log('Natural voice checks passed: preferred engine, warning priority, no repeated alerts.');
}
