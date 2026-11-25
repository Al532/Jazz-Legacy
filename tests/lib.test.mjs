import test from 'node:test';
import assert from 'node:assert/strict';
import { videoIdFromText,parseClock,clock,mergeItems,visibleItems } from '../public/lib.mjs';
test('URL NewPipe / YouTube: liens et partage texte',()=>{
  assert.equal(videoIdFromText('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=4s'),'dQw4w9WgXcQ');
  assert.equal(videoIdFromText('Partager cette vidéo : https://youtu.be/dQw4w9WgXcQ'),'dQw4w9WgXcQ');
  assert.equal(videoIdFromText('https://youtube.com/shorts/dQw4w9WgXcQ'),'dQw4w9WgXcQ');
  assert.equal(videoIdFromText('https://www.evil.com/watch?v=dQw4w9WgXcQ'),null);
});
test('temps',()=>{
  assert.equal(parseClock('1:23'),83); assert.equal(parseClock('1:02:03'),3723);
  assert.equal(parseClock('0:20.5'),20.5); assert.equal(parseClock(''),null);
  assert.equal(clock(83), '1:23'); assert.ok(Number.isNaN(parseClock('abc')));
});
test('fusion / suppressions',()=>{
  const a={id:'x',updatedAt:2,deleted:true,order:0}, b={id:'x',updatedAt:1,deleted:false,order:0};
  assert.deepEqual(mergeItems([a],[b]),[a]);
  assert.deepEqual(visibleItems([a,b]),[b]);
});
