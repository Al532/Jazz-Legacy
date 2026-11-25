const cataloguePrefix = 'jazz-legacy/';
const releaseId = /^[0-9a-f]{64}$/;
const catalogueKey = id => `${cataloguePrefix}releases/${id}.json`;

async function activeCatalogue(bucket) {
  const active = await bucket.get(cataloguePrefix + 'current.json');
  if (!active) return null;
  const {release} = await active.json();
  if (!releaseId.test(release)) throw new Error('Catalogue invalide');
  const object = await bucket.get(catalogueKey(release));
  if (!object) throw new Error('Catalogue indisponible');
  return {...await object.json(), release};
}

async function cloudUser(request, env) {
  const token = request.headers.get('Cookie')?.match(/(?:^|;\s*)__Host-jazz-session=([^;]+)/)?.[1];
  return token ? await validatedUser(token, env) : null;
}

async function validatedUser(token, env) {
  if (!/^[\w.-]{1,8192}$/.test(token)) return null;
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) return null;
  const response = await fetch(env.SUPABASE_URL + '/auth/v1/user', {
    headers: {apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}`},
    signal: AbortSignal.timeout(5000),
  });
  const user = response.ok ? await response.json() : null;
  return user?.id && user.email_confirmed_at ? user : null;
}

async function setCloudSession(request, env) {
  if (request.method !== 'POST' || request.headers.get('Origin') !== new URL(request.url).origin) return json({}, 403);
  const token = request.headers.get('Authorization')?.match(/^Bearer ([\w.-]{1,8192})$/)?.[1];
  const user = token ? await validatedUser(token, env) : null;
  const cookie = `__Host-jazz-session=${user ? token : ''}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${user ? 3600 : 0}`;
  return new Response(null, {status: token && !user ? 401 : 204, headers: {'Set-Cookie': cookie, 'Cache-Control': 'no-store'}});
}

async function cloudStoredAudioStream(env, id) {
  try {
    const release = await activeCatalogue(env.MEDIA);
    if (!release) return {storedAudio: 'storageUnavailable'};
    return Object.hasOwn(release.audio, id) ? {url: '/api/audio/' + id} : {storedAudio: 'notUploaded'};
  } catch {
    return {storedAudio: 'storageUnavailable'};
  }
}

async function cloudMedia(request, env, path) {
  const isCatalogue = path === '/catalogue-data.json';
  const isCover = path.startsWith('/api/cover/');
  const isLoudness = path === '/api/loudness' || path === '/api/loudness/status';
  if (!['GET', 'HEAD'].includes(request.method)) return json({}, 405);
  if (isLoudness || path === '/api/audio/status') {
    const user = await cloudUser(request, env);
    if (!user?.id || user.id !== env.JAZZ_OWNER_ID) {
      if (isLoudness) return json({state: user ? 'accessDenied' : 'signIn'});
      return json({error: 'Accès réservé au propriétaire.'}, user ? 403 : 401);
    }
  }
  const data = await activeCatalogue(env.MEDIA);
  if (!data) return json({error: 'Catalogue non publié.'}, 503);
  if (isCatalogue) return new Response(request.method === 'HEAD' ? null : JSON.stringify(data.catalogue), {
    headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Catalogue-Release': data.release},
  });
  if (path === '/api/audio') return json({enabled: true, ids: Object.keys(data.audio)});
  if (path === '/api/audio/status') return json({enabled: true, connected: true});
  if (path === '/api/loudness/status') return json({state: data.loudness ? 'available' : 'missing'});
  if (path === '/api/loudness') return json(data.loudness ? {state: 'available', data: data.loudness} : {state: 'missing'});
  const id = path.slice((isCover ? '/api/cover/' : '/api/audio/').length);
  if (!audioId.test(id)) return json({}, 404);
  const key = (isCover ? data.covers : data.audio)[id];
  const legacyKey = isCover ? /^jaquettes\/(images|miniatures-youtube)\/[\w.-]+\.(avif|jpe?g|png|webp)$/i : /^[^/\\]+\[[\w-]{11}\]\.mp3$/i;
  const extension = typeof key === 'string' ? key.split('.').at(-1).toLowerCase() : '';
  const allowedType = isCover ? Object.hasOwn(artworkTypes, extension) : extension === 'mp3';
  const versionedKey = /^jazz-legacy\/media\/[0-9a-f]{64}\.[a-z0-9]+$/;
  if (!allowedType || !(versionedKey.test(key) || legacyKey.test(key))) return json({}, 404);
  const range = request.headers.get('Range');
  if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) return json({}, 416);
  const head = request.method === 'HEAD' || range ? await env.MEDIA.head(key) : null;
  if ((request.method === 'HEAD' || range) && !head) return json({}, 404);
  let bounds;
  if (range) {
    const [first, last] = range.slice(6).split('-');
    const start = first ? Number(first) : Math.max(0, head.size - Number(last));
    const end = first && last ? Math.min(Number(last), head.size - 1) : head.size - 1;
    if (start > end) return new Response(null, {status: 416, headers: {'Content-Range': `bytes */${head.size}`}});
    bounds = {offset: start, length: end - start + 1};
  }
  const object = request.method === 'HEAD' ? head : await env.MEDIA.get(key, bounds ? {range: bounds} : undefined);
  if (!object) return json({}, 404);
  const headers = new Headers({'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff'});
  headers.set('Content-Type', isCover ? artworkTypes[extension] : 'audio/mpeg');
  headers.set('Content-Length', String(bounds?.length ?? object.size));
  if (bounds) headers.set('Content-Range', `bytes ${bounds.offset}-${bounds.offset + bounds.length - 1}/${head.size}`);
  return new Response(request.method === 'HEAD' ? null : object.body, {status: bounds ? 206 : 200, headers});
}
