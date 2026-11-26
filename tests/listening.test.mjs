import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildLibrary, groupByStandard, keepImportsInPlaylists, playable, playlistRecordings, shuffle, shuffleStandards, suggestStandard} from '../public/listening.mjs';
import {videoIdFromText} from '../public/lib.mjs';

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

test('un lien privé rejoint le bon standard et reste dans une playlist après suppression de sa destination', () => {
  const catalogue = [
    {id: 'blue', title: 'Blue'},
    {id: 'blue-bossa', title: 'Blue Bossa', aliases: ['Bossa bleue'], versions: [{youtube: 'abcdefghijk'}]},
  ];
  assert.equal(suggestStandard('Dexter Gordon – Blue Bossa (live)', catalogue).id, 'blue-bossa');
  assert.equal(suggestStandard('Une bossa bleue !', catalogue).id, 'blue-bossa');
  assert.equal(suggestStandard('Bluebird', catalogue), undefined);
  assert.equal(videoIdFromText('Artiste https://m.youtube.com/shorts/abcdefghijk', {youtubeLink: true}), 'abcdefghijk');
  assert.equal(videoIdFromText('https://example.test/?v=abcdefghijk', {youtubeLink: true}), null);
  assert.equal(videoIdFromText('abcdefghijk', {youtubeLink: true}), null);
  const imports = [
    {id: 'youtube:abcdefghijk', videoId: 'abcdefghijk', title: 'Blue Bossa', order: 1, updatedAt: 1},
    {id: 'youtube:abcdefghijx', videoId: 'abcdefghijx', title: 'Blue Bossa', standardId: 'blue-bossa', order: 2, updatedAt: 2},
  ];
  const playlists = [];
  keepImportsInPlaylists(playlists, imports);
  keepImportsInPlaylists(playlists, imports);
  const groups = buildLibrary(catalogue, imports);
  assert.deepEqual(playlistRecordings(groups, playlists[0].entries).map(track => track.id), ['blue-bossa:abcdefghijk', imports[1].id]);
  assert.equal(groups[1].recordings[0].youtubeImportId, imports[0].id);
  assert.equal(playlists.length, 1);
  assert.equal(playlists[0].entries.length, 2);
});

test('chaque cycle aléatoire contient chaque version une fois et évite la dernière en tête', () => {
  const randomized = shuffle(['a','b','c','c'], 'a', () => 0.99);
  assert.notEqual(randomized[0], 'a');
  assert.deepEqual(randomized.sort(), ['a','b','c']);
  assert.deepEqual(shuffle(['a'], 'a'), ['a']);
});

test('la radio choisit une version par standard et évite de rejouer le dernier standard', () => {
  const tracks = [
    {id: 'a1', standardId: 'a', mp3: true},
    {id: 'a2', standardId: 'a'},
    {id: 'b1', standardId: 'b'},
    {id: 'c1', standardId: 'c', mp3: true},
    {id: 'c2', standardId: 'c', mp3: true},
  ];
  const groups = groupByStandard(tracks);
  const queue = shuffleStandards(groups, 'a', track => track.mp3, () => .99);
  assert.deepEqual(queue, ['b1', 'c2', 'a1']);
  assert.deepEqual(shuffleStandards(new Map(), 'a', () => false), []);
});
