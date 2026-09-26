import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const handlers = {}, cached = { body: 'old shell' }, fresh = { ok: true, clone: () => fresh };
let offline = false, fetchOptions, writes = 0;
runInNewContext(readFileSync(new URL('../site/sw.js', import.meta.url), 'utf8'), {
  URL,
  self: { location: { href: 'https://example.com/sw.js?v=test', toString: () => 'https://example.com/sw.js?v=test', origin: 'https://example.com' }, addEventListener: (name, fn) => handlers[name] = fn },
  caches: { match: async () => cached, open: async () => ({ put: async () => writes++ }) },
  fetch: async (_, options) => { fetchOptions = options; if (offline) throw Error('offline'); return fresh; },
});
async function request(destination, pathname = '/js/layout.js') {
  let result;
  handlers.fetch({ request: { method: 'GET', destination, url: 'https://example.com' + pathname }, respondWith: p => result = p });
  return await result;
}
assert.equal(await request('script'), fresh);
assert.equal(fetchOptions.cache, 'no-cache');
assert.equal(writes, 1);
offline = true;
assert.equal(await request('script'), cached);
assert.equal(await request('image', '/icon.png'), cached);
assert.equal(await request('', '/api/forecast'), undefined);
console.log('Shell cache: revalidates code, preserves offline fallback and cached images, excludes APIs.');
