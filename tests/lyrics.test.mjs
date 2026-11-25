import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';

test('lyrics are stored by standard and account, separate from the public playlist', async () => {
  const values = new Map();
  const env = {BUCKET: {
    async get(key) { return values.has(key) ? {json: async () => JSON.parse(values.get(key))} : null; },
    async put(key, value) { values.set(key, value); },
  }};
  const call = (id, standard, text) => worker.fetch(new Request('https://heads.test/api/lyrics/' + standard, {
    headers: id ? {'oai-authenticated-user-id': id} : {},
    ...(text === undefined ? {} : {method: 'PUT', body: JSON.stringify({text})}),
  }), env);
  assert.deepEqual(await (await call(null, 'autumnleaves')).json(), {text: '', signIn: true});
  assert.equal((await call(null, 'autumnleaves', 'private')).status, 401);
  assert.equal((await call('one', 'autumnleaves', ' Exemple de paroles. ')).status, 200);
  assert.deepEqual(await (await call('one', 'autumnleaves')).json(), {text: 'Exemple de paroles.'});
  assert.deepEqual(await (await call('two', 'autumnleaves')).json(), {text: ''});
  assert.deepEqual(await (await call('one', 'bodyandsoul')).json(), {text: ''});
  assert.equal((await call('one', 'autumnleaves', 'x'.repeat(30001))).status, 400);
});
