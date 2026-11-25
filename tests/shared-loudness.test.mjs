import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';
import {parseLoudness, volumeForTrack} from '../public/loudness.mjs';

const env = {
  HEADS_R2_ENDPOINT: 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com',
  HEADS_R2_KEY_ID: 'loudness-test-key',
  HEADS_R2_SECRET: 'test-secret',
  HEADS_AUDIO_OWNER_EMAIL: 'owner@example.test',
};
const readings = {
  tracks: [
    {youtubeId: 'kADmgRtwXaU', integrated_lufs: -20},
    {filename: 'Audio Heads/Body and Soul [QI3wWiquZGc].mp3', integrated_lufs: -10},
  ],
};

function request(path, email, options = {}) {
  return new Request('https://heads.test' + path, {
    ...options,
    headers: email ? {'oai-authenticated-user-id': 'user', 'oai-authenticated-user-email': email} : {},
  });
}

test('shared loudness is loaded from the private R2 file for the owner across devices', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async (url, {method}) => {
    assert.equal(url, env.HEADS_R2_ENDPOINT + '/heads-audio/loudness.json');
    return new Response(method === 'HEAD' ? null : JSON.stringify(readings));
  });
  const get = async (path, email) => (await worker.fetch(request(path, email), env)).json();
  assert.deepEqual(await get('/api/loudness'), {state: 'signIn'});
  assert.deepEqual(await get('/api/loudness', 'other@example.test'), {state: 'accessDenied'});
  assert.equal(fetch.mock.callCount(), 0);
  assert.deepEqual(await get('/api/loudness/status'), {state: 'signIn'});
  assert.deepEqual(await get('/api/loudness/status', 'owner@example.test'), {state: 'available'});
  assert.equal(fetch.mock.calls[0].arguments[1].method, 'HEAD');
  const first = await get('/api/loudness', 'owner@example.test');
  const second = await get('/api/loudness', 'OWNER@EXAMPLE.TEST');
  assert.deepEqual(first, {state: 'available', data: readings});
  assert.deepEqual(second, first);
  assert.equal(fetch.mock.callCount(), 2);
  const records = parseLoudness(first.data);
  assert.equal(volumeForTrack({videoId: 'kADmgRtwXaU'}, records), 1);
  assert.ok(Math.abs(volumeForTrack({videoId: 'QI3wWiquZGc'}, records) - 10 ** (-10 / 20)) < 1e-9);
  assert.equal(volumeForTrack({videoId: 'missing'}, records), 1);
  assert.equal((await worker.fetch(request('/api/loudness', 'owner@example.test', {method: 'PUT'}), env)).status, 405);
});

test('an absent or invalid shared file gives a neutral playback fallback', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, {headers}) =>
    headers.Authorization.includes('missing-key') ? new Response(null, {status: 404}) :
      new Response('invalid JSON'));
  for (const [key, state] of [['missing-key', 'missing'], ['invalid-key', 'invalid']]) {
    const response = await worker.fetch(request('/api/loudness', 'owner@example.test'), {...env, HEADS_R2_KEY_ID: key});
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {state});
  }
});

test('the player levels complete recordings using the Windows analyser output', () => {
  const records = parseLoudness({
    schemaVersion: 1,
    targetLUFS: -16,
    ceilingDBTP: -1,
    recordings: {
      'allofme:r2T-MOu68ps': {youtubeId: 'r2T-MOu68ps', track: {gainDB: 3}, head: {gainDB: -6}},
      'bodyandsoul:QI3wWiquZGc': {youtubeId: 'QI3wWiquZGc', track: {gainDB: -7}},
    },
  });
  assert.equal(records.length, 2);
  assert.equal(volumeForTrack({videoId: 'r2T-MOu68ps'}, records), 1);
  assert.ok(Math.abs(volumeForTrack({id: 'bodyandsoul:QI3wWiquZGc'}, records) - 10 ** (-10 / 20)) < 1e-9);
  assert.equal(volumeForTrack({videoId: 'unmeasured0'}, records), 1);
});
