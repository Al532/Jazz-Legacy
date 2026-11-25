import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';

const id = 'TestVideo01';
const key = 'jazz-legacy/media/' + 'c'.repeat(64) + '.mp3';
const first = 'a'.repeat(64);
const second = 'b'.repeat(64);

test('online refresh reads the active release; only the validated owner can stream media', async t => {
  let active = first;
  const bytes = Uint8Array.from([1, 2, 3, 4]);
  const MEDIA = {
    get: async (name, options) => {
      if (name.endsWith('current.json')) return {json: async () => ({release: active})};
      if (name === `jazz-legacy/releases/${active}.json`) return {json: async () => ({
        catalogue: {standards: [{id: active}]}, audio: {[id]: key}, covers: {[id]: key},
      })};
      if (name !== key) return null;
      const {offset = 0, length = bytes.length} = options?.range ?? {};
      return {body: bytes.slice(offset, offset + length), size: bytes.length};
    },
    head: async name => name === key ? {size: bytes.length} : null,
  };
  const env = {DEPLOYMENT: 'cloudflare', MEDIA, JAZZ_OWNER_ID: 'owner',
    SUPABASE_URL: 'https://supabase.example', SUPABASE_PUBLISHABLE_KEY: 'stub'};
  t.mock.method(globalThis, 'fetch', async (_url, {headers}) => Response.json({
    id: headers.Authorization.endsWith('owner-token') ? 'owner' : 'other', email_confirmed_at: 'today',
  }));
  const get = (path, headers) => worker.fetch(new Request('https://jazz.test' + path, {headers}), env);
  const catalogue = await get('/catalogue-data.json');
  assert.equal(catalogue.headers.get('Cache-Control'), 'no-store');
  assert.equal(catalogue.headers.get('X-Catalogue-Release'), first);
  active = second;
  assert.deepEqual(await (await get('/catalogue-data.json')).json(), {standards: [{id: second}]});
  assert.equal((await get('/api/cover/' + id)).status, 404);
  assert.equal((await get('/api/audio/' + id, {'oai-authenticated-user-id': 'owner'})).status, 401);
  assert.equal((await get('/api/audio/' + id, {Cookie: '__Host-jazz-session=other-token'})).status, 403);
  const media = await get('/api/audio/' + id, {Cookie: '__Host-jazz-session=owner-token', Range: 'bytes=1-2'});
  assert.equal(media.status, 206);
  assert.equal(media.headers.get('Content-Range'), 'bytes 1-2/4');
  assert.deepEqual([...new Uint8Array(await media.arrayBuffer())], [2, 3]);
});
