const audioBucket = 'heads-audio';
const audioId = /^[A-Za-z0-9_-]{11}$/;
const audioEncoder = new TextEncoder();
const emptyPayloadHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const configNames = ['HEADS_R2_ENDPOINT', 'HEADS_R2_KEY_ID', 'HEADS_R2_SECRET'];
let audioIndexCache;
let audioProbeCache;
let loudnessCache;
let loudnessProbeCache;
const loudnessObject = 'loudness.json';
const maxLoudnessSize = 2 * 1024 * 1024;

function r2Config(env) {
  const [address, keyId, secret] = configNames.map(name =>
    typeof env[name] === 'string' ? env[name].trim() : '');
  const owner = typeof env.HEADS_AUDIO_OWNER_EMAIL === 'string' ? env.HEADS_AUDIO_OWNER_EMAIL.trim().toLowerCase() : '';
  const missing = configNames.filter(name => typeof env[name] !== 'string' || !env[name].trim());
  const invalid = [];
  let endpoint;
  if (address) {
    try {
      endpoint = new URL(address);
      if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.port ||
          /[?#]/.test(address) || !['/', '/heads-audio', '/heads-audio/'].includes(endpoint.pathname) ||
          !/^[a-f0-9]{32}(?:\.(?:eu|fedramp))?\.r2\.cloudflarestorage\.com$/.test(endpoint.hostname)) {
        throw new Error();
      }
    } catch { invalid.push('HEADS_R2_ENDPOINT'); }
  }
  if (keyId && !/^[A-Za-z0-9_-]+$/.test(keyId)) invalid.push('HEADS_R2_KEY_ID');
  if (missing.length || invalid.length) return {missing, invalid};
  return {config: {endpoint, keyId, secret, owner}};
}

function r2Failure(code) {
  return Object.assign(new Error(code), {r2Code: code});
}

function r2Unavailable(error, operation) {
  const code = error.r2Code || 'R2_UNAVAILABLE';
  console.warn('Jazz Legacy R2', operation, code);
  return {enabled: true, code, error: 'Stockage audio momentanément indisponible.'};
}

const awsEncode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const toHex = bytes => Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
async function hmac(key, value) {
  const imported = await crypto.subtle.importKey('raw', key, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return crypto.subtle.sign('HMAC', imported, audioEncoder.encode(value));
}

async function r2Get(config, {object, query = {}, range, method = 'GET', timeout = object ? 0 : 10000} = {}) {
  const timestamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = timestamp.slice(0, 8);
  const scope = date + '/auto/s3/aws4_request';
  const path = '/' + audioBucket + (object ? '/' + object.split('/').map(awsEncode).join('/') : '');
  const canonicalQuery = Object.keys(query).sort().map(key => awsEncode(key) + '=' + awsEncode(query[key])).join('&');
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalHeaders = 'host:' + config.endpoint.host + '\nx-amz-content-sha256:' + emptyPayloadHash + '\nx-amz-date:' + timestamp + '\n';
  const canonical = [method, path, canonicalQuery, canonicalHeaders, signedHeaders, emptyPayloadHash].join('\n');
  const digest = toHex(await crypto.subtle.digest('SHA-256', audioEncoder.encode(canonical)));
  const dateKey = await hmac(audioEncoder.encode('AWS4' + config.secret), date);
  const regionKey = await hmac(dateKey, 'auto');
  const serviceKey = await hmac(regionKey, 's3');
  const signingKey = await hmac(serviceKey, 'aws4_request');
  const signature = toHex(await hmac(signingKey, ['AWS4-HMAC-SHA256', timestamp, scope, digest].join('\n')));
  const headers = {
    'x-amz-content-sha256': emptyPayloadHash,
    'x-amz-date': timestamp,
    Authorization: 'AWS4-HMAC-SHA256 Credential=' + config.keyId + '/' + scope +
      ', SignedHeaders=' + signedHeaders + ', Signature=' + signature,
  };
  if (range) headers.Range = range;
  try {
    return await fetch(config.endpoint.origin + path + (canonicalQuery ? '?' + canonicalQuery : ''), {
      method, headers, redirect: 'manual', ...(timeout ? {signal: AbortSignal.timeout(timeout)} : {}),
    });
  } catch (error) {
    throw r2Failure(error.name === 'TimeoutError' ? 'R2_TIMEOUT' : 'R2_CONNECTION_FAILED');
  }
}

async function checkR2Response(response) {
  if (response.ok) return;
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw r2Failure('R2_UNEXPECTED_REDIRECT');
  }
  if (response.status >= 500) {
    await response.body?.cancel();
    throw r2Failure('R2_UPSTREAM_ERROR');
  }
  const xml = await response.text();
  const code = xml.match(/<Code>([A-Za-z0-9]+)<\/Code>/)?.[1];
  if (['InvalidAccessKeyId', 'SignatureDoesNotMatch', 'InvalidToken', 'ExpiredToken',
    'AuthorizationHeaderMalformed', 'RequestTimeTooSkewed'].includes(code)) throw r2Failure('R2_AUTH_FAILED');
  if (code === 'NoSuchBucket' || response.status === 404) throw r2Failure('R2_BUCKET_NOT_FOUND');
  if (response.status === 401 || response.status === 403) throw r2Failure('R2_ACCESS_DENIED');
  throw r2Failure('R2_REQUEST_REJECTED');
}

async function listAudioObjects(config, query = {}) {
  const response = await r2Get(config, {query: {'list-type': '2', 'encoding-type': 'url', ...query}});
  await checkR2Response(response);
  const xml = await response.text();
  if (!/<ListBucketResult(?:\s[^>]*)?>[\s\S]*<\/ListBucketResult>/.test(xml)) {
    throw r2Failure('R2_INVALID_RESPONSE');
  }
  return xml;
}

function cachedFor(entry, config) {
  return entry?.expires > Date.now() && entry.config.endpoint.origin === config.endpoint.origin &&
    entry.config.keyId === config.keyId && entry.config.secret === config.secret;
}

async function probeAudio(config) {
  const xml = await listAudioObjects(config, {'max-keys': '1000'});
  const index = new Map();
  indexAudioObjects(xml, index);
  const object = index.values().next().value;
  if (!object) return {enabled: true, connected: true, read: 'no_matching_audio'};
  const response = await r2Get(config, {object, range: 'bytes=0-0', timeout: 10000});
  await checkR2Response(response);
  if (response.status !== 206 || !/^bytes 0-0\/[1-9]\d*$/.test(response.headers.get('Content-Range') || '')) {
    await response.body?.cancel();
    throw r2Failure('R2_RANGE_UNAVAILABLE');
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== 1) throw r2Failure('R2_INVALID_RESPONSE');
  return {enabled: true, connected: true, read: 'verified'};
}

async function audioStatus(config) {
  if (!cachedFor(audioProbeCache, config)) {
    const promise = probeAudio(config).then(
      data => ({status: 200, data}),
      error => ({status: 502, data: {...r2Unavailable(error, 'probe'), connected: false}}),
    );
    audioProbeCache = {config, expires: Date.now() + 60000, promise};
  }
  const {data, status} = await audioProbeCache.promise;
  return json(data, status);
}

function xmlValue(value) {
  return value.replace(/&(?:amp|lt|gt|quot|apos|#x[0-9a-f]+|#\d+);/gi, entity => {
    const literals = {'&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'"};
    if (entity in literals) return literals[entity];
    const hex = entity.startsWith('&#x');
    return String.fromCodePoint(parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10));
  });
}

function indexAudioObjects(xml, index) {
  for (const [, value] of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) {
    let key;
    try { key = decodeURIComponent(xmlValue(value)); }
    catch { continue; }
    const match = key.match(/\[([A-Za-z0-9_-]{11})\]\.mp3$/i) || key.match(/(?:^|\/)([A-Za-z0-9_-]{11})\.mp3$/i);
    if (match && !index.has(match[1])) index.set(match[1], key);
  }
}

async function loadAudioIndex(config) {
  const index = new Map();
  let continuation;
  for (let page = 0; page < 10; page++) {
    const xml = await listAudioObjects(config, continuation ? {'continuation-token': continuation} : {});
    indexAudioObjects(xml, index);
    const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1];
    if (!next) return index;
    continuation = xmlValue(next);
  }
  return index;
}

async function audioIndex(config) {
  if (cachedFor(audioIndexCache, config)) return audioIndexCache.promise;
  const entry = {config, expires: Date.now() + 60000, promise: loadAudioIndex(config)};
  audioIndexCache = entry;
  try { return await entry.promise; }
  catch (error) {
    if (audioIndexCache === entry) audioIndexCache = null;
    throw error;
  }
}

function audioAccess(request, config) {
  const userId = request.headers.get('oai-authenticated-user-id');
  const email = request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
  if (!userId || !email) return 'signIn';
  return email === config.owner ? 'owner' : 'accessDenied';
}

async function readSharedLoudness(config, probe) {
  const response = await r2Get(config, {object: loudnessObject, method: probe ? 'HEAD' : 'GET', timeout: 4000});
  if (response.status === 404) {
    await response.body?.cancel();
    return {state: 'missing'};
  }
  await checkR2Response(response);
  const length = Number(response.headers.get('Content-Length'));
  if (length > maxLoudnessSize) {
    await response.body?.cancel();
    return {state: 'invalid'};
  }
  if (probe) return {state: 'available'};
  const reader = response.body?.getReader();
  if (!reader) return {state: 'invalid'};
  const decoder = new TextDecoder();
  let size = 0;
  let body = '';
  for (;;) {
    const {value, done} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxLoudnessSize) {
      await reader.cancel();
      return {state: 'invalid'};
    }
    body += decoder.decode(value, {stream: true});
  }
  try {
    const data = JSON.parse(body + decoder.decode());
    return data && typeof data === 'object' ? {state: 'available', data} : {state: 'invalid'};
  } catch {
    return {state: 'invalid'};
  }
}

async function serveSharedLoudness(request, env, probe) {
  if (request.method !== 'GET') return json({error: 'Méthode interdite'}, 405);
  const {config} = r2Config(env);
  if (!config) return json({state: 'unavailable'});
  const access = audioAccess(request, config);
  if (access !== 'owner') return json({state: access});
  let entry = probe ? loudnessProbeCache : loudnessCache;
  if (!cachedFor(entry, config)) {
    const promise = readSharedLoudness(config, probe).catch(error => {
      r2Unavailable(error, 'loudness');
      return {state: 'unavailable'};
    });
    entry = {config, expires: Date.now() + 60000, promise};
    if (probe) loudnessProbeCache = entry;
    else loudnessCache = entry;
  }
  return json(await entry.promise);
}

async function storedAudioStream(env, id) {
  const {config} = r2Config(env);
  if (!config) return {};
  try {
    return (await audioIndex(config)).has(id) ? {url: '/api/audio/' + id} : {storedAudio: 'notUploaded'};
  } catch (error) {
    r2Unavailable(error, 'lookup');
    return {storedAudio: 'storageUnavailable'};
  }
}

async function serveStoredAudio(request, env, path) {
  const listing = path === '/api/audio';
  const status = path === '/api/audio/status';
  const id = path.slice('/api/audio/'.length);
  if (!listing && !status && !audioId.test(id)) return json({error: 'Introuvable'}, 404);
  if (request.method !== 'GET' && (listing || status || request.method !== 'HEAD')) return json({error: 'Méthode interdite'}, 405);
  const {config, missing, invalid} = r2Config(env);
  if (!config) return json({enabled: false, code: missing.length ? 'R2_CONFIG_MISSING' : 'R2_CONFIG_INVALID',
    missing, invalid}, 503);
  if (status) {
    const access = audioAccess(request, config);
    if (access === 'signIn') return json({enabled: true, signIn: true}, 401);
    if (access === 'accessDenied') return json({error: 'Accès réservé au propriétaire.'}, 403);
    return audioStatus(config);
  }
  try {
    const index = await audioIndex(config);
    if (listing) return json({enabled: true, ids: [...index.keys()]});
    const object = index.get(id);
    if (!object) return json({code: 'AUDIO_NOT_UPLOADED', error: 'Audio introuvable'}, 404);
    const range = request.headers.get('Range');
    if (range && !/^bytes=(?:[0-9]+-[0-9]*|-[0-9]+)$/.test(range)) return json({error: 'Plage invalide'}, 416);
    const response = await r2Get(config, {object, range, method: request.method});
    if (response.status === 404) {
      audioIndexCache = null;
      await response.body?.cancel();
      return json({code: 'AUDIO_NOT_UPLOADED', error: 'Audio introuvable'}, 404);
    }
    if (response.status !== 416) await checkR2Response(response);
    const headers = new Headers({'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store',
      'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff'});
    for (const name of ['Content-Range', 'ETag']) {
      if (response.headers.has(name)) headers.set(name, response.headers.get(name));
    }
    if (response.status === 416) {
      await response.body?.cancel();
      return new Response(null, {status: 416, headers});
    }
    if (response.headers.has('Content-Length')) headers.set('Content-Length', response.headers.get('Content-Length'));
    return new Response(response.body, {status: response.status, headers});
  } catch (error) {
    return json(r2Unavailable(error, listing ? 'list' : 'object'), 502);
  }
}
