import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, createHmac} from 'node:crypto';
import worker from '../dist/server/index.js';

test('public MP3 lookup and streaming preserve byte ranges and owner-only diagnostics', async t => {
  const env = {
    HEADS_R2_ENDPOINT: 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com',
    HEADS_R2_KEY_ID: 'test-key',
    HEADS_R2_SECRET: 'test-secret',
    HEADS_AUDIO_OWNER_EMAIL: 'owner@example.test',
  };
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({url, init});
    if (url.includes('list-type=2')) {
      return new Response('<ListBucketResult><Contents><Key>Body%20and%20Soul%20%5BQI3wWiquZGc%5D.mp3</Key></Contents>' +
        '<Contents><Key>loudness.json</Key></Contents></ListBucketResult>');
    }
    if (init.headers.Range === 'bytes=0-0') return new Response(new Uint8Array([10]), {
      status: 206, headers: {'content-range': 'bytes 0-0/10'},
    });
    return new Response(new Uint8Array([10, 20]), {
      status: 206, headers: {'content-range': 'bytes 0-1/10', 'content-length': '2'},
    });
  });
  const get = (path, email, extra = {}, config = env) => worker.fetch(new Request('https://heads.test' + path, {
    headers: email ? {...extra, 'oai-authenticated-user-id': 'test-user', 'oai-authenticated-user-email': email} : extra,
  }), config);
  assert.equal((await get('/api/audio', null, {}, {})).status, 503);
  assert.equal((await get('/api/audio/loudness.json')).status, 404);
  assert.equal((await worker.fetch(new Request('https://heads.test/api/audio/QI3wWiquZGc', {method: 'PUT'}), env)).status, 405);
  assert.equal((await get('/api/audio/status')).status, 401);
  assert.equal((await get('/api/audio/status', 'other@example.test')).status, 403);
  assert.equal(calls.length, 0);
  assert.deepEqual(await (await get('/api/audio', null, {}, {...env, HEADS_AUDIO_OWNER_EMAIL: undefined})).json(),
    {enabled: true, ids: ['QI3wWiquZGc']});
  const stream = '/api/stream/QI3wWiquZGc';
  const expected = {available: true, url: '/api/audio/QI3wWiquZGc', mimeType: 'audio/mpeg', storedAudio: 'available'};
  assert.deepEqual(await (await get(stream)).json(), expected);
  assert.deepEqual(await (await get(stream, 'other@example.test')).json(), expected);
  assert.equal((await (await get('/api/stream/kADmgRtwXaU')).json()).storedAudio, 'notUploaded');
  assert.equal((await (await get(stream + '?external=1')).json()).available, false);
  assert.equal((await get('/api/audio/dQw4w9WgXcQ')).status, 404);
  const response = await get('/api/audio/QI3wWiquZGc', null, {Range: 'bytes=0-1'});
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Content-Range'), 'bytes 0-1/10');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [10, 20]);
  const transferCalls = calls.slice();
  assert.deepEqual(await (await get('/api/audio/status', 'owner@example.test')).json(),
    {enabled: true, connected: true, read: 'verified'});
  assert.equal(calls.length, 4);
  assert.equal(calls[3].init.headers.Range, 'bytes=0-0');
  assert.equal(transferCalls.length, 2);
  assert.match(calls[1].url, /heads-audio\/Body%20and%20Soul%20%5BQI3wWiquZGc%5D\.mp3$/);
  assert.equal(calls[1].init.headers.Range, 'bytes=0-1');
  assert.equal(calls[1].init.redirect, 'manual');
  const sign = (key, input) => createHmac('sha256', key).update(input).digest();
  const {url, init} = calls[1];
  const timestamp = init.headers['x-amz-date'];
  const day = timestamp.slice(0, 8);
  const scope = day + '/auto/s3/aws4_request';
  const emptyHash = createHash('sha256').digest('hex');
  const canonical = 'GET\n/heads-audio/Body%20and%20Soul%20%5BQI3wWiquZGc%5D.mp3\n\n' +
    'host:' + new URL(url).host + '\nx-amz-content-sha256:' + emptyHash + '\nx-amz-date:' + timestamp +
    '\n\nhost;x-amz-content-sha256;x-amz-date\n' + emptyHash;
  const signingKey = ['auto', 's3', 'aws4_request'].reduce(sign, sign('AWS4test-secret', day));
  const signature = sign(signingKey, 'AWS4-HMAC-SHA256\n' + timestamp + '\n' + scope + '\n' +
    createHash('sha256').update(canonical).digest('hex')).toString('hex');
  assert.ok(init.headers.Authorization.endsWith(', Signature=' + signature));
});

test('R2 diagnostics distinguish environment and upstream errors and accept an empty bucket', async t => {
  const env = {
    HEADS_R2_ENDPOINT: ' https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/heads-audio/ ',
    HEADS_R2_KEY_ID: 'empty-test-key',
    HEADS_R2_SECRET: 'test-secret',
    HEADS_AUDIO_OWNER_EMAIL: 'owner@example.test',
  };
  const get = (config, path = '/api/audio/status') => worker.fetch(new Request('https://heads.test' + path, {
    headers: {'oai-authenticated-user-id': 'test-user', 'oai-authenticated-user-email': 'owner@example.test'},
  }), config);
  let response = await get({...env, HEADS_R2_ENDPOINT: 'https://wrong.test/sensitive', HEADS_R2_SECRET: ' '});
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {enabled: false, code: 'R2_CONFIG_MISSING',
    missing: ['HEADS_R2_SECRET'], invalid: ['HEADS_R2_ENDPOINT']});
  const fetch = t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.match(url, /cloudflarestorage\.com\/heads-audio\?encoding-type=url&list-type=2/);
    const credential = init.headers.Authorization.split(' ')[1].split('/')[0];
    if (credential.endsWith('bad-signature')) return new Response(
      '<Error><Code>SignatureDoesNotMatch</Code><Message>private</Message></Error>', {status: 403});
    if (credential.endsWith('denied')) return new Response('<Error><Code>AccessDenied</Code></Error>', {status: 403});
    if (credential.endsWith('redirect')) return Response.redirect('https://other.example.test/');
    if (credential.endsWith('offline')) throw new Error('private network details');
    return new Response('<ListBucketResult><KeyCount>0</KeyCount></ListBucketResult>');
  });
  for (const [key, code] of [['bad-signature', 'R2_AUTH_FAILED'], ['denied', 'R2_ACCESS_DENIED'],
    ['offline', 'R2_CONNECTION_FAILED'], ['redirect', 'R2_UNEXPECTED_REDIRECT']]) {
    response = await get({...env, HEADS_R2_KEY_ID: key});
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.code, code);
    assert.equal(body.connected, false);
    assert.doesNotMatch(JSON.stringify(body), /private|sensitive/);
  }
  assert.deepEqual(await (await get(env)).json(), {enabled: true, connected: true, read: 'no_matching_audio'});
  assert.deepEqual(await (await get(env)).json(), {enabled: true, connected: true, read: 'no_matching_audio'});
  assert.equal(fetch.mock.callCount(), 5);
  assert.deepEqual(await (await get(env, '/api/audio')).json(), {enabled: true, ids: []});
  assert.equal((await get(env, '/api/audio/kADmgRtwXaU')).status, 404);
});

test('public covers resolve only image objects associated with an exact recording ID', async t => {
  const env = {
    HEADS_R2_ENDPOINT: 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com',
    HEADS_R2_KEY_ID: 'cover-test-key',
    HEADS_R2_SECRET: 'test-secret',
  };
  const id = '-n418MI0TAY';
  const fetch = t.mock.method(globalThis, 'fetch', async (url, {method}) => {
    if (url.endsWith('/index.json')) return Response.json({miniatures: [
      {youtube: id, fichier: 'youtube--n418MI0TAY-maxresdefault.webp'},
      {youtube: 'dQw4w9WgXcQ', fichier: '../loudness.json'},
    ]});
    assert.match(url, /\/heads-audio\/jaquettes\/miniatures-youtube\/youtube--n418MI0TAY-maxresdefault\.webp$/);
    return new Response(method === 'HEAD' ? null : new Uint8Array([10, 20]),
      {headers: {'Content-Type': 'application/octet-stream', 'Content-Length': '2'}});
  });
  const get = (id, method) => worker.fetch(new Request('https://heads.test/api/cover/' + id, {method}), env);
  assert.equal((await get('loudness.json')).status, 404);
  assert.equal((await get(id, 'PUT')).status, 405);
  assert.equal(fetch.mock.callCount(), 0);
  const response = await get(id);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'image/webp');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [10, 20]);
  const head = await get(id, 'HEAD');
  assert.equal(head.headers.get('Content-Length'), '2');
  assert.equal(head.body, null);
  assert.equal((await get('dQw4w9WgXcQ')).status, 404);
  assert.equal(fetch.mock.callCount(), 3);
});

test('a matched release cover takes priority over the uploaded thumbnail', async t => {
  const env = {
    HEADS_R2_ENDPOINT: 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com',
    HEADS_R2_KEY_ID: 'release-cover-test-key',
    HEADS_R2_SECRET: 'test-secret',
  };
  const fetch = t.mock.method(globalThis, 'fetch', async url => {
    assert.match(url, /\/heads-audio\/jaquettes\/images\/edition-fictive\.jpg$/);
    return new Response(new Uint8Array([1]), {headers: {'Content-Length': '1'}});
  });
  const response = await worker.fetch(new Request('https://heads.test/api/cover/TestVideo01'), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'image/jpeg');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1]);
  assert.equal(fetch.mock.callCount(), 1);
});
