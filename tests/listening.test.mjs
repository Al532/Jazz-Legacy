import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildLibrary, playable, playlistRecordings, shuffle} from '../public/listening.mjs';

test('le catalogue, les ajouts existants alimentent le lecteur intégral', async () => {
  const catalogue = JSON.parse(await readFile(new URL('../public/catalogue-data.json', import.meta.url)));
  const groups = buildLibrary(catalogue.standards, [
    {id:'legacy', title:'Ancien titre', videoId:'TestVideo01', start:4, end:42, order:0, updatedAt:1},
    {id:'custom-id', standardId:'standard-de-test', title:'Standard de test', videoId:'abcdefghijk', start:0, end:null, order:1, updatedAt:1},
  ]);
  assert.equal(groups.length, 1);
  const versions = playable(groups[0]);
  const cannonball = versions.find(version => version.videoId === 'TestVideo01');
  assert.equal(cannonball.savedId, 'legacy');
  assert.equal(cannonball.start, undefined);
  assert.equal(cannonball.musicians.length, 5);
  assert.equal(versions.filter(version => version.videoId === 'TestVideo01').length, 1);
  assert.equal(versions.at(-1).id, 'custom-id');
  assert.deepEqual(playlistRecordings(groups, ['standard:standard-de-test', 'version:' + cannonball.id]), versions);
  assert.deepEqual(playlistRecordings(groups, ['version:' + cannonball.id]), [cannonball]);
});

test('chaque cycle aléatoire contient chaque version une fois et évite la dernière en tête', () => {
  const randomized = shuffle(['a','b','c','c'], 'a', () => 0.99);
  assert.notEqual(randomized[0], 'a');
  assert.deepEqual(randomized.sort(), ['a','b','c']);
  assert.deepEqual(shuffle(['a'], 'a'), ['a']);
});
