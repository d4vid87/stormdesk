import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const handlers = {}, cached = { body: 'old shell' };
let offline = false, storageFailure = false, writeFailure = false, fetchOptions;
let writes = 0, matchedCache, cacheControl = '', deleted = [], claimed = false;
const fresh = { ok: true, clone: () => fresh, headers: { get: () => cacheControl } };
runInNewContext(readFileSync(new URL('../site/sw.js', import.meta.url), 'utf8'), {
  URL, Set,
  self: {
    location: { toString: () => 'https://example.com/sw.js?v=test', origin: 'https://example.com' },
    addEventListener: (name, fn) => handlers[name] = fn,
    clients: { claim: async () => { claimed = true; } },
  },
  caches: {
    keys: async () => ['wd-shell-test', 'wd-shell-test-public-assets', 'unrelated-cache'],
    delete: async name => { deleted.push(name); },
    open: async name => {
      if (storageFailure) throw Error('cache unavailable');
      matchedCache = name;
      return {
        match: async () => cached,
        put: async () => { if (writeFailure) throw Error('quota exceeded'); writes++; },
      };
    },
  },
  fetch: async (_, options) => { fetchOptions = options; if (offline) throw Error('offline'); return fresh; },
});
async function request(destination, pathname = '/js/layout.js', options = {}) {
  let result;
  const tasks = [];
  handlers.fetch({
    request: { method: 'GET', destination, url: 'https://example.com' + pathname, headers: new Headers(), ...options },
    respondWith: p => { result = p; }, waitUntil: p => tasks.push(p),
  });
  const response = await result;
  await Promise.all(tasks);
  return response;
}

assert.equal(await request('script'), fresh);
assert.equal(fetchOptions.cache, 'no-cache');
assert.equal(writes, 1);
assert.equal(matchedCache, 'wd-shell-test-public-assets', 'Only the current shell cache is read');
offline = true;
assert.equal(await request('script'), cached);
assert.equal(await request('image', '/icon.png'), cached);
for (const route of ['/api/forecast', '/config', '/pair/devices', '/pair/start', '/archive/backup', '/history.csv']) {
  assert.equal(await request('', route), undefined, `${route} fetch is never intercepted`);
  assert.equal(await request('document', route), undefined, `${route} navigation is never intercepted`);
}
assert.equal(await request('', '/new-private-endpoint'), undefined, 'Unknown fetch endpoints are not shell assets');
assert.equal(await request('document', '/', { headers: new Headers({ Authorization: 'Bearer test' }) }), undefined);
assert.equal(await request('script', '/js/layout.js', { method: 'POST' }), undefined);
assert.equal(await request('script', '', { url: 'https://other.example/app.js' }), undefined);

offline = false;
for (const directive of ['private, max-age=600', 'no-store']) {
  cacheControl = directive;
  assert.equal(await request('document', '/'), fresh);
  assert.equal(writes, 1, 'Private/no-store responses are never persisted');
}
cacheControl = '';
storageFailure = true;
assert.equal(await request('script'), fresh, 'Disabled cache still permits successful network loads');
storageFailure = false; writeFailure = true;
assert.equal(await request('script'), fresh, 'Quota errors are contained in the cache task');
let activation;
handlers.activate({ waitUntil: p => { activation = p; } });
await activation;
assert.deepEqual(deleted, ['wd-shell-test'], 'Old potentially sensitive shell cache is removed on activation');
assert.ok(claimed);
console.log('Shell cache: private/API isolation, current-cache scope, offline fallback and storage failures passed.');
