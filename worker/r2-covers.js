const artworkTypes = {avif: 'image/avif', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp'};
const thumbnailFolder = 'jaquettes/miniatures-youtube/';
const releaseArtworkFolder = 'jaquettes/images/';
let artworkIndexCache;

async function loadArtworkIndex(config) {
  const response = await r2Get(config, {object: thumbnailFolder + 'index.json', timeout: 5000});
  if (response.status === 404) {
    await response.body?.cancel();
    return new Map();
  }
  await checkR2Response(response);
  const {miniatures} = await response.json();
  const index = new Map();
  for (const row of Array.isArray(miniatures) ? miniatures : []) {
    if (!audioId.test(row?.youtube) || typeof row.fichier !== 'string') continue;
    const filename = row.fichier.match(/^youtube-([A-Za-z0-9_-]{11})-[a-z0-9]+\.(avif|jpe?g|png|webp)$/i);
    if (filename?.[1] !== row.youtube) continue;
    index.set(row.youtube, {key: thumbnailFolder + row.fichier, type: artworkTypes[filename[2].toLowerCase()]});
  }
  return index;
}

async function artworkIndex(config) {
  if (cachedFor(artworkIndexCache, config)) return artworkIndexCache.promise;
  const entry = {config, expires: Date.now() + 60000, promise: loadArtworkIndex(config)};
  artworkIndexCache = entry;
  try { return await entry.promise; }
  catch (error) {
    if (artworkIndexCache === entry) artworkIndexCache = null;
    throw error;
  }
}

async function readArtwork(config, cover, method) {
  if (!cover) return null;
  const response = await r2Get(config, {object: cover.key, method, timeout: 8000});
  if (response.status === 404) {
    await response.body?.cancel();
    return null;
  }
  await checkR2Response(response);
  return {response, type: cover.type};
}

function releaseArtwork(id) {
  // The source index associates each filename with the standard and version number.
  const file = RECORDING_COVERS[id];
  const extension = typeof file === 'string' && file.match(/^[a-z0-9][a-z0-9_-]*\.(avif|jpe?g|png|webp)$/i)?.[1];
  if (extension) return {key: releaseArtworkFolder + file, type: artworkTypes[extension.toLowerCase()]};
}

async function serveCover(request, env, id) {
  if (!audioId.test(id)) return new Response(null, {status: 404});
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, {status: 405});
  const {config} = r2Config(env);
  if (!config) return new Response(null, {status: 503});
  try {
    const cover = await readArtwork(config, releaseArtwork(id), request.method) ||
      await readArtwork(config, (await artworkIndex(config)).get(id), request.method);
    if (!cover) return new Response(null, {status: 404, headers: {'Cache-Control': 'no-store'}});
    const {response, type} = cover;
    const headers = new Headers({
      'Content-Type': type, 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff',
    });
    for (const name of ['Content-Length', 'ETag']) {
      if (response.headers.has(name)) headers.set(name, response.headers.get(name));
    }
    return new Response(response.body, {headers});
  } catch (error) {
    r2Unavailable(error, 'cover');
    return new Response(null, {status: 502});
  }
}
