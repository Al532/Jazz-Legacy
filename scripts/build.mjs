import {readFile, mkdir, readdir, writeFile} from 'node:fs/promises';

const types = {
  json: 'application/json; charset=utf-8',
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  png: 'image/png',
  webmanifest: 'application/manifest+json',
};
const assets = {};
for (const name of await readdir('public')) {
  const extension = name.split('.').pop();
  const binary = extension === 'png';
  assets['/' + name] = {
    body: await readFile('public/' + name, binary ? 'base64' : 'utf8'),
    type: types[extension] || 'application/octet-stream',
    ...(binary ? {binary: true} : {}),
  };
}
assets['/supabase.js'] = {
  body: await readFile('node_modules/@supabase/supabase-js/dist/umd/supabase.js', 'utf8'),
  type: types.js,
};
await mkdir('dist/server', {recursive: true});
await writeFile('dist/server/index.js', 'const ASSETS=' + JSON.stringify(assets) + ';\n' +
  'const RECORDING_COVERS={TestVideo01:"edition-fictive.jpg"};\n' +
  await readFile('worker/r2-audio.js', 'utf8') + '\n' + await readFile('worker/r2-covers.js', 'utf8') + '\n' +
  await readFile('worker/catalogue.js', 'utf8') + '\n' +
  await readFile('worker/index.js', 'utf8'));
console.log('Built Jazz Legacy Worker and ' + Object.keys(assets).length + ' assets.');
