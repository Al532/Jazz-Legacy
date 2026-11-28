import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';
import pages from '../pages/public/_worker.js';
import {parseLoudness, volumeForTrack} from '../public/loudness.mjs';

const id = 'TestVideo01';
const key = 'jazz-legacy/media/' + 'c'.repeat(64) + '.mp3';
const coverId = 'OtherTest01';
const coverKey = 'jazz-legacy/media/' + 'd'.repeat(64) + '.png';
const first = 'a'.repeat(64);
const second = 'b'.repeat(64);

test('online refresh reads the active release and anyone can stream its published MP3s', async t => {
  let active = first;
  const bytes = Uint8Array.from([1, 2, 3, 4]);
  const MEDIA = {
    get: async (name, options) => {
      if (name.endsWith('current.json')) return {json: async () => ({release: active})};
      if (name === `jazz-legacy/releases/${active}.json`) return {json: async () => ({
        catalogue: {standards: [{id: active}]}, audio: {[id]: key}, covers: {[id]: key, [coverId]: coverKey},
      })};
      if (name !== key && name !== coverKey) return null;
      const {offset = 0, length = bytes.length} = options?.range ?? {};
      return {body: bytes.slice(offset, offset + length), size: bytes.length};
    },
    head: async name => name === key ? {size: bytes.length} : null,
  };
  const env = {DEPLOYMENT: 'cloudflare', MEDIA, JAZZ_OWNER_ID: 'owner',
    SUPABASE_URL: 'https://supabase.example', SUPABASE_PUBLISHABLE_KEY: 'stub'};
  const auth = t.mock.method(globalThis, 'fetch', async (_url, {headers}) => Response.json({
    id: headers.Authorization.endsWith('owner-token') ? 'owner' : 'other', email_confirmed_at: 'today',
  }));
  const get = (path, headers) => worker.fetch(new Request('https://jazz.test' + path, {headers}), env);
  const catalogue = await get('/catalogue-data.json');
  assert.equal(catalogue.headers.get('Cache-Control'), 'no-store');
  assert.equal(catalogue.headers.get('X-Catalogue-Release'), first);
  active = second;
  assert.deepEqual(await (await get('/catalogue-data.json')).json(), {standards: [{id: second}]});
  assert.equal((await get('/api/cover/' + id)).status, 404);
  const cover = await get('/api/cover/' + coverId);
  assert.equal(cover.headers.get('Cache-Control'), 'public, max-age=3600');
  assert.equal(cover.headers.get('Content-Type'), 'image/png');
  const audioIndex = await get('/api/audio');
  assert.equal(audioIndex.headers.get('X-Catalogue-Release'), second);
  assert.deepEqual(await audioIndex.json(), {enabled: true, ids: [id]});
  const stream = await (await get('/api/stream/' + id)).json();
  assert.equal(stream.url, '/api/audio/' + id);
  assert.equal((await (await get('/api/stream/' + id + '?external=1')).json()).available, false);
  assert.equal((await get('/api/audio/OtherTest01')).status, 404);
  const media = await get('/api/audio/' + id, {Range: 'bytes=1-2'});
  assert.equal(media.status, 206);
  assert.equal(media.headers.get('Content-Range'), 'bytes 1-2/4');
  assert.deepEqual([...new Uint8Array(await media.arrayBuffer())], [2, 3]);
  const head = await worker.fetch(new Request('https://jazz.test/api/audio/' + id, {method: 'HEAD'}), env);
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('Content-Length'), '4');
  assert.equal(head.body, null);
  assert.equal(auth.mock.callCount(), 0);
  assert.equal((await get('/api/audio/status')).status, 401);
  assert.deepEqual(await (await get('/api/loudness')).json(), {state: 'signIn'});
  assert.equal((await get('/api/audio/status', {Cookie: '__Host-jazz-session=other-token'})).status, 403);
  assert.equal((await get('/api/audio/status', {Cookie: '__Host-jazz-session=owner-token'})).status, 200);
});

test('visitors can level published audio without signing in', async () => {
  const MEDIA = {get: async name => ({json: async () => name.endsWith('current.json') ? {release: first} : {
    audio: {[id]: key, r2TMOu68psA: key},
    loudness: {
      schemaVersion: 1,
      recordings: {
        ['standard:' + id]: {youtubeId: id, track: {gainDB: -7, integratedLUFS: -9}, head: {gainDB: 0}},
        'allofme:r2TMOu68psA': {youtubeId: 'r2TMOu68psA', track: {gainDB: 3}},
        'unpublished:OtherTest01': {youtubeId: 'OtherTest01', track: {gainDB: 12}},
      },
    },
  }})};
  const get = path => worker.fetch(new Request('https://jazz.test' + path), {DEPLOYMENT: 'cloudflare', MEDIA});
  const playback = await (await get('/api/loudness?playback=1')).json();
  assert.deepEqual(playback, {state: 'available', data: {tracks: [
    {id: 'standard:' + id, youtubeId: id, gainDb: -7},
    {id: 'allofme:r2TMOu68psA', youtubeId: 'r2TMOu68psA', gainDb: 3},
  ]}});
  const records = parseLoudness(playback.data);
  assert.equal(volumeForTrack({videoId: 'r2TMOu68psA'}, records), 1);
  assert.ok(Math.abs(volumeForTrack({videoId: id}, records) - 10 ** (-10 / 20)) < 1e-9);
  assert.deepEqual(await (await get('/api/loudness')).json(), {state: 'signIn'});
  assert.deepEqual(await (await get('/api/loudness/status?playback=1')).json(), {state: 'signIn'});
});

test('Pages relays the original request and Workers redirects old links to the neutral address', async () => {
  const neutralOrigin = 'https://jazz-legacy.pages.dev';
  const env = {DEPLOYMENT: 'cloudflare', MEDIA: {}, JAZZ_PUBLIC_ORIGIN: neutralOrigin};
  const query = '/?version=standard%3ATestVideo01';
  const old = await worker.fetch(new Request('https://jazz-legacy.example.workers.dev' + query), env);
  assert.equal(old.status, 302);
  assert.equal(old.headers.get('Location'), neutralOrigin + query);
  const request = new Request(neutralOrigin + '/api/audio/' + id, {headers: {Range: 'bytes=1-2'}});
  const result = await pages.fetch(request, {JAZZ_LEGACY: {fetch(incoming) {
    assert.equal(incoming, request);
    return new Response('audio', {status: 206});
  }}});
  assert.equal(result.status, 206);
  assert.equal(await result.text(), 'audio');
  assert.equal((await worker.fetch(new Request(neutralOrigin + query), env)).status, 200);
});
