import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {audioCache, coverCache} from '../public/media-cache.mjs';

test('audio preparation follows queue priority, cancels obsolete work and reuses complete files', async t => {
  const downloads = [];
  t.mock.method(globalThis, 'fetch', (url, {signal}) => new Promise(resolve => {
    downloads.push({url, signal, resolve});
  }));
  const mp3 = () => new Response('audio data', {headers: {'Content-Type': 'audio/mpeg'}});
  const cache = audioCache();
  t.after(() => cache.clear());

  cache.prepare(['/old-track']);
  cache.prepare(['/next-track', '/alternate-version']);
  assert.equal(downloads[0].signal.aborted, true);
  assert.deepEqual(downloads.map(({url}) => url), ['/old-track', '/next-track']);
  downloads[0].resolve(mp3());
  downloads[1].resolve(mp3());
  await setImmediate();

  assert.equal(cache.get('/old-track'), undefined);
  assert.equal(await cache.get('/next-track').text(), 'audio data');
  assert.equal(downloads[2].url, '/alternate-version');
  downloads[2].resolve(mp3());
  await setImmediate();
  cache.prepare(['/next-track', '/alternate-version']);
  assert.equal(downloads.length, 3);

  cache.clear();
  assert.equal(cache.get('/next-track'), undefined);
});

test('audio preparation skips partial or oversized responses and continues with the queue', async t => {
  const responses = [
    new Response('partial', {status: 206, headers: {'Content-Type': 'audio/mpeg'}}),
    new Response('audio', {headers: {'Content-Type': 'audio/mpeg', 'Content-Length': String(13 * 1024 * 1024)}}),
    new Response('complete', {headers: {'Content-Type': 'audio/mpeg'}}),
  ];
  const fetch = t.mock.method(globalThis, 'fetch', async () => responses.shift());
  const cache = audioCache();
  t.after(() => cache.clear());
  const urls = ['/partial', '/oversized', '/complete'];
  cache.prepare(urls);
  await setImmediate();
  assert.equal(cache.get('/partial'), undefined);
  assert.equal(cache.get('/oversized'), undefined);
  assert.equal(await cache.get('/complete').text(), 'complete');
  cache.prepare(urls);
  assert.equal(fetch.mock.callCount(), 3);
});

test('cover preparation shares downloads with the player and remembers the fallback', async t => {
  const requested = [];
  const originalImage = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  globalThis.Image = class {
    set src(url) {
      requested.push(url);
      queueMicrotask(() => url === '/missing' ? this.onerror() : this.onload());
    }
  };
  t.after(() => {
    if (originalImage) Object.defineProperty(globalThis, 'Image', originalImage);
    else delete globalThis.Image;
  });
  const loadCover = coverCache();
  const covers = ['/missing', '/fallback'];
  assert.deepEqual(await Promise.all([loadCover(covers), loadCover(covers, 'auto')]), ['/fallback', '/fallback']);
  assert.equal(await loadCover(covers), '/fallback');
  assert.deepEqual(requested, covers);
});
