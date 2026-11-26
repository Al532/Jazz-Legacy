import test from 'node:test';
import assert from 'node:assert/strict';
import {libraryRecords, libraryFromRecords, queueChanges, queueGuestAdditions} from '../public/sync.mjs';

test('les modifications portent sur un favori, une playlist ou une piste séparément', () => {
  const a = libraryRecords({favorites: ['one'], playlists: [{id: 'list', name: 'Jazz', entries: ['version:one']}]});
  const b = libraryRecords({favorites: ['two'], playlists: [{id: 'list', name: 'Jazz', entries: ['version:one', 'version:two']}]});
  const pending = {};
  queueChanges(a, b, pending);

  assert.deepEqual(Object.fromEntries(Object.entries(pending).map(([id, change]) => [id, change.value])), {
    '["favorite","one"]': null,
    '["favorite","two"]': true,
    '["member","list","version:two"]': true,
  });

  const remote = {...a, '["member","list","version:three"]': true};
  for (const [id, change] of Object.entries(pending)) remote[id] = change.value;
  assert.deepEqual(libraryFromRecords(remote), {
    favorites: ['two'],
    playlists: [{id: 'list', name: 'Jazz', entries: ['version:one', 'version:three', 'version:two']}],
    imports: [],
    mode: undefined,
  });
  remote['["playlist","list"]'] = null;
  assert.deepEqual(libraryFromRecords(remote).playlists, []);
});

test('les liens invités ajoutés après un premier transfert rejoignent le compte avec leur playlist', () => {
  const item = {id: 'youtube:abcdefghijk', videoId: 'abcdefghijk', title: 'Nardis', order: 1, updatedAt: 1};
  const playlists = [{id: 'youtube-imports', name: 'Liens YouTube', entries: [`version:${item.id}`]}];
  const previous = libraryRecords({favorites: ['déjà transféré']});
  const guest = libraryRecords({favorites: ['déjà transféré', 'supprimé sur le compte'], imports: [item], playlists});
  const remote = {'["favorite","supprimé sur le compte"]': null};
  const pending = {};
  queueGuestAdditions(guest, previous, remote, pending);
  const additions = Object.fromEntries(Object.entries(pending).map(([id, change]) => [id, change.value]));
  assert.deepEqual(libraryFromRecords({...remote, ...additions}), {favorites: [], imports: [item], playlists, mode: undefined});
  const retry = {};
  queueGuestAdditions(guest, guest, {...remote, ...additions}, retry);
  assert.deepEqual(retry, {});
});

test('le dernier mode d’écoute est sérialisé avec la bibliothèque', () => {
  const mode = {type: 'playlist', id: 'list'};
  assert.deepEqual(libraryFromRecords(libraryRecords({}, mode)).mode, mode);
});
