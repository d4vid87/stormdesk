// One queue for official alerts, briefings and the explicit voice test.
export function shouldSpeak({ category, title = '', headline = '' }, s) {
  return !!s.speakAlerts && s.notif?.severe !== false && category === 'severe'
    && (/\b(warning|watch)\b/i.test(title) || /\bemergency\b/i.test(`${title} ${headline}`));
}

const rank = (e) => (['Unknown', 'Minor', 'Moderate', 'Severe', 'Extreme'].indexOf(e.severity) + 1)
  + (/\bemergency\b/i.test(`${e.title} ${e.headline}`) ? 10 : 0);
const priority = (e) => /\bemergency\b/i.test(`${e.title} ${e.headline}`) ? 0 : /\bwarning\b/i.test(e.title) ? 1 : 2;
const errors = {
  'not-allowed': 'Tap to enable',
  'synthesis-unavailable': 'No speech engine available. Try a browser with speech support.',
  'voice-unavailable': 'No usable voice. Install a system voice and test again.',
  'language-unavailable': 'No usable voice. Install a system voice and test again.',
  'audio-hardware': 'Audio output unavailable. Check your speakers.',
  'audio-busy': 'Audio output is busy. Test again.',
  'synthesis-failed': 'System speech failed. Check installed voices and audio, restart your browser, then test again.',
  timeout: 'Speech did not start. Tap Enable / Test voice to retry.',
};

export function createSpeech({ synth, Utterance, native, settings, status, now = Date.now,
  later = setTimeout, cancelTimer = clearTimeout, language = 'en-US' }) {
  let live = new Map(), delivered = new Map(), queue = [], active = null, blocked = false, location = '';
  const valid = (e) => !e.expires || e.expires > now();
  const allowed = (e) => shouldSpeak(e, settings()) && valid(e);
  function pending() {
    return [...live.values()].filter((e) => allowed(e) && (delivered.get(e.id) ?? -1) < rank(e))
      .sort((a, b) => priority(a) - priority(b));
  }
  function finish(job, error) {
    if (active !== job) return;
    cancelTimer(job.timer);
    active = null;
    if (error) {
      if (job.utter) job.utter.onstart = job.utter.onend = job.utter.onerror = null;
      synth?.cancel();
      blocked = true;
      status(errors[error] || `Speech failed: ${error}. Test again.`);
    } else {
      if (job.alert && job.place === location && live.has(job.alert.id)) delivered.set(job.alert.id, Math.max(delivered.get(job.alert.id) ?? -1, rank(job.alert)));
      status('Ready');
      pump();
    }
  }
  function fail(job, error) {
    if (active !== job || job.fallingBack) return;
    if (job.alert && (!allowed(job.alert) || !live.has(job.alert.id) || job.place !== location)) {
      stopStale();
      pump();
      return;
    }
    if (!job.started && !job.retriedVoices && error !== 'timeout' &&
      ['synthesis-unavailable', 'voice-unavailable', 'language-unavailable'].includes(error) && synth && !synth.getVoices().length) {
      job.waitingVoices = true;
      status('Waiting for system voices…');
      return; // voiceschanged or the existing ten-second deadline will resolve this.
    }
    cancelTimer(job.timer);
    if (!job.started && native) {
      job.fallingBack = true;
      // Detach handlers before cancel: an interrupted browser utterance must never complete
      // a native replacement or cause a second fallback.
      if (job.utter) { job.utter.onstart = job.utter.onend = job.utter.onerror = null; }
      synth?.cancel();
      status('Speaking');
      Promise.resolve().then(() => native(job.words)).then(() => finish(job), (e) => finish(job, String(e)));
    } else finish(job, error);
  }
  function start(job) {
    job.place = location;
    active = job;
    job.timer = later(() => fail(job, 'timeout'), 10000);
    if (!synth || !Utterance) { fail(job, 'synthesis-unavailable'); return; }
    try {
      const utter = job.utter = new Utterance(job.words);
      const voices = synth.getVoices();
      const voice = voices.find((v) => v.lang === language) || voices.find((v) => v.lang?.startsWith(language.split('-')[0])) || voices.find((v) => v.default) || voices[0];
      if (voice) { utter.voice = voice; utter.lang = voice.lang; }
      else utter.lang = language;
      utter.onstart = () => { if (active !== job || job.fallingBack) return; job.started = true; cancelTimer(job.timer); status('Speaking'); };
      utter.onend = () => finish(job);
      utter.onerror = (e) => fail(job, e.error || 'synthesis-failed');
      if (synth.paused) synth.resume();
      synth.speak(utter);
    } catch { fail(job, 'synthesis-unavailable'); }
  }
  function pump() {
    if (active || blocked) return;
    const alert = pending()[0];
    const job = alert ? { alert, words: `${/\bemergency\b/i.test(`${alert.title} ${alert.headline}`) ? 'Emergency. ' : ''}${alert.title}. ${alert.headline || ''}` } : queue.shift();
    if (job) start(job);
  }
  function stopStale() {
    if (!active?.alert || (live.has(active.alert.id) && allowed(active.alert))) return;
    // Native output already in progress may finish; queued alerts are removed immediately.
    if (active.fallingBack) return;
    const job = active;
    active = null;
    cancelTimer(job.timer);
    if (job.utter) job.utter.onstart = job.utter.onend = job.utter.onerror = null;
    synth?.cancel();
    status('Ready');
  }
  return {
    sync(entries, place) {
      if (place !== location) { location = place; live.clear(); delivered.clear(); stopStale(); }
      live = new Map(entries.filter(valid).map((e) => [e.id, e]));
      for (const id of delivered.keys()) if (!live.has(id)) delivered.delete(id);
      stopStale();
      // All simultaneous alerts are collected before choosing warnings ahead of watches.
      later(pump, 300);
    },
    changed(place) {
      if (place !== location) { location = place; live.clear(); delivered.clear(); }
      stopStale();
      pump();
    },
    say(words, delay = 0) {
      if (!words) return;
      const add = () => { queue.push({ words }); pump(); };
      if (delay) later(add, delay); else add();
    },
    test() {
      blocked = false;
      if (active) return;
      // Keep this synchronous: the button's user activation unlocks browser audio.
      start({ words: 'StormDesk voice test. This is only a test of spoken watches and warnings.' });
    },
    voicesChanged() {
      if (active?.waitingVoices && synth.getVoices().length) {
        const job = active;
        job.waitingVoices = false;
        job.retriedVoices = true;
        cancelTimer(job.timer);
        if (job.utter) job.utter.onstart = job.utter.onend = job.utter.onerror = null;
        synth.cancel();
        start(job);
      } else if (!blocked) pump();
    },
  };
}
