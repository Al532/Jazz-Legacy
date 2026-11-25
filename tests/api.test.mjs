import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';
import {MockBucket} from '../scripts/mock-bucket.mjs';
const item={id:'123',videoId:'dQw4w9WgXcQ',title:'Recording',order:1,updatedAt:4,deleted:false};
const ownerHeaders = {'oai-authenticated-user-id': 'owner-id', 'oai-authenticated-user-email': 'owner@example.test'};
const req=(path,body,origin)=>new Request('https://heads.test'+path,body?{method:'PUT',headers:{...ownerHeaders,'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:JSON.stringify(body)}:{});
test('persistent sync, validation and conflict protection',async()=>{
 const env={BUCKET:new MockBucket(), HEADS_AUDIO_OWNER_EMAIL:'owner@example.test'};
 assert.deepEqual(await (await worker.fetch(req('/api/data'),env)).json(),{version:0,items:[],canEdit:false});
 const results=await Promise.all([worker.fetch(req('/api/data',{version:0,items:[item]}),env),worker.fetch(req('/api/data',{version:0,items:[{...item,id:'second'}]}),env)]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const saved=await(await worker.fetch(req('/api/data'),env)).json();assert.equal(saved.version,1);assert.equal(saved.items.length,1);
 assert.equal((await worker.fetch(req('/api/data',{version:1,items:[{...item,videoId:'invalid'}]}),env)).status,400);
 assert.equal((await worker.fetch(new Request('https://heads.test/api/data',{method:'PUT',body:'{}'}),env)).status,403);
 assert.equal((await worker.fetch(req('/api/data',{version:1,items:[item]},'https://other.test'),env)).status,403);
 assert.equal((await worker.fetch(req('/api/data',{version:0,items:[]}),env)).status,409);
 assert.equal((await worker.fetch(new Request('https://heads.test/api/data',{method:'PUT',headers:ownerHeaders,body:'{'}),env)).status,400);
 assert.equal((await worker.fetch(req('/manifest.webmanifest'),env)).status,200);
 assert.equal((await worker.fetch(req('/api/data'),{})).status,503);
});

test('an unavailable external stream has a usable fallback and the manifest declares its encoding', async t => {
 const path = '/api/stream/kADmgRtwXaU';
 const fallbackUrl = 'https://www.youtube.com/watch?v=kADmgRtwXaU';
 assert.deepEqual(await (await worker.fetch(req(path), {})).json(),
   {available: false, code: 'PIPED_NOT_CONFIGURED', fallbackUrl});
 t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unavailable'); });
 assert.deepEqual(await (await worker.fetch(req(path), {PIPED_API_URL: 'https://piped.example.test/'})).json(),
   {available: false, code: 'PIPED_UNAVAILABLE', fallbackUrl});
 const manifest = await (await worker.fetch(req('/manifest.webmanifest'), {})).json();
 assert.equal(manifest.share_target.enctype, 'application/x-www-form-urlencoded');
});
