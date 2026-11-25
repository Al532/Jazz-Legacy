const key = 'playlist.json';
const json = (data, status=200) => Response.json(data, {status, headers:{'Cache-Control':'no-store'}});
const validItems = items => Array.isArray(items) && items.length<=2000 && items.every(x=>
  x && typeof x.id==='string' && x.id.length>0 && x.id.length<=100 &&
  typeof x.videoId==='string' && /^[\w-]{11}$/.test(x.videoId) &&
  typeof x.title==='string' && x.title.length<=240 &&
  Number.isFinite(x.order) && Number.isFinite(x.updatedAt) && typeof x.deleted==='boolean');
function catalogueItems(items) {
  return items.map(({start, end, startMarked, ...item}) => item);
}

async function snapshot(bucket) {
  const obj=await bucket.get(key);
  const data = obj ? await obj.json() : {version: 0, items: []};
  return {data: {...data, items: catalogueItems(data.items)}, etag: obj?.etag};
}
async function fetchJson(url,timeout=9000) {
  const r=await fetch(url,{signal:AbortSignal.timeout(timeout),headers:{Accept:'application/json'}});
  if(!r.ok)throw new Error(`Source indisponible (${r.status})`);
  return r.json();
}
async function serveLyrics(request, env, standardId) {
  if (request.method !== 'GET' && request.method !== 'PUT') return json({error: 'Méthode interdite'}, 405);
  const userId = request.headers.get('oai-authenticated-user-id');
  if (!userId) return request.method === 'GET' ? json({text: '', signIn: true}) : json({signIn: true}, 401);
  if (!env.BUCKET) return json({error: 'Stockage indisponible.'}, 503);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId));
  const userKey = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const objectKey = 'lyrics/' + userKey + '/' + standardId + '.json';
  if (request.method === 'GET') {
    const object = await env.BUCKET.get(objectKey);
    return json({text: object ? (await object.json()).text : ''});
  }
  const reader = request.body?.getReader();
  if (!reader) return json({error: 'Paroles manquantes.'}, 400);
  const decoder = new TextDecoder();
  let size = 0;
  let contents = '';
  for (;;) {
    const {value, done} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 200000) { await reader.cancel(); return json({error: 'Texte trop long.'}, 413); }
    contents += decoder.decode(value, {stream: true});
  }
  let text;
  try { text = JSON.parse(contents + decoder.decode()).text; }
  catch { return json({error: 'Paroles illisibles.'}, 400); }
  if (typeof text !== 'string' || text.length > 30000) return json({error: 'Paroles invalides ou trop longues.'}, 400);
  await env.BUCKET.put(objectKey, JSON.stringify({text: text.trim()}));
  return json({text: text.trim()});
}

export default {
  async fetch(request,env) {
    try {
      const url=new URL(request.url), path=url.pathname;
      if (env.DEPLOYMENT === 'cloudflare') {
        if (!env.MEDIA) return json({error: 'Stockage indisponible'}, 503);
        if (path === '/api/session') return await setCloudSession(request, env);
        if (path === '/supabase-config.mjs') return new Response(
          'export const supabaseUrl = ' + JSON.stringify(env.SUPABASE_URL || '') + ';\n' +
          'export const supabasePublishableKey = ' + JSON.stringify(env.SUPABASE_PUBLISHABLE_KEY || '') + ';',
          {headers: {'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store'}},
        );
        if (path === '/catalogue-data.json' || path.startsWith('/api/cover/') || path === '/api/audio' ||
            path.startsWith('/api/audio/') || path === '/api/loudness' || path === '/api/loudness/status') {
          return await cloudMedia(request, env, path);
        }
        if (path === '/api/data') {
          if (request.method !== 'GET') return json({}, 405);
          const active = await activeCatalogue(env.MEDIA);
          return json({version: 0, items: active?.items ?? [], canEdit: false});
        }
        const privateLyrics = path.match(/^\/api\/lyrics\/([A-Za-z0-9_:-]{1,160})$/);
        if (privateLyrics) {
          if (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) return json({}, 403);
          const user = await cloudUser(request, env);
          const headers = new Headers(request.headers);
          headers.delete('oai-authenticated-user-id');
          if (user) headers.set('oai-authenticated-user-id', user.id);
          return await serveLyrics(new Request(request, {headers}), {BUCKET: env.MEDIA}, privateLyrics[1]);
        }
      }
      if(request.method==='PUT' && request.headers.get('Origin') && request.headers.get('Origin')!==url.origin)return json({error:'Origine refusée'},403);
      if(path==='/api/loudness' || path==='/api/loudness/status')return await serveSharedLoudness(request,env,path.endsWith('/status'));
      if(path==='/api/audio' || path.startsWith('/api/audio/'))return await serveStoredAudio(request,env,path);
      if(path.startsWith('/api/cover/'))return await serveCover(request,env,path.slice('/api/cover/'.length));
      const lyrics = path.match(/^\/api\/lyrics\/([A-Za-z0-9_:-]{1,160})$/);
      if (lyrics) return await serveLyrics(request, env, lyrics[1]);
      if(path==='/api/health')return json({ok:true,syncEnabled:!!env.BUCKET,pipedConfigured:!!env.PIPED_API_URL?.trim()});
      if(path==='/api/data'){
        if (request.method !== 'GET' && request.method !== 'PUT') return json({error: 'Méthode interdite'}, 405);
        const owner = typeof env.HEADS_AUDIO_OWNER_EMAIL === 'string' && env.HEADS_AUDIO_OWNER_EMAIL.trim().toLowerCase();
        const canEdit = Boolean(owner && audioAccess(request, {owner}) === 'owner');
        if (request.method === 'PUT' && !canEdit) return json({error: 'Accès réservé au propriétaire.'}, 403);
        if (!env.BUCKET) return json({error: 'Stockage indisponible.'}, 503);
        const current = await snapshot(env.BUCKET);
        if (request.method === 'GET') return json({...current.data, canEdit});
        if(Number(request.headers.get('Content-Length'))>1048576)return json({error:'Données trop volumineuses'},413);
        const reader=request.body?.getReader();let size=0;const chunks=[];
        if(!reader)return json({error:'JSON invalide'},400);
        while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>1048576){await reader.cancel();return json({error:'Données trop volumineuses'},413);}chunks.push(value);}
        const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
        let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{return json({error:'JSON invalide'},400);}
        if(!Number.isInteger(body?.version)||!validItems(body.items))return json({error:'Playlist invalide'},400);
        if(body.version!==current.data.version)return json(current.data,409);
        const next={version:body.version+1,items:catalogueItems(body.items)};
        const saved=await env.BUCKET.put(key,JSON.stringify(next),{onlyIf:current.etag?{etagMatches:current.etag}:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});
        if(!saved)return json((await snapshot(env.BUCKET)).data,409);
        return json(next);
      }
      const meta=path.match(/^\/api\/meta\/([\w-]{11})$/);
      if(meta && request.method==='GET'){
        try{const d=await fetchJson(`https://www.youtube.com/oembed?url=${encodeURIComponent('https://www.youtube.com/watch?v='+meta[1])}&format=json`,7000);return json({title:d.title||'',uploader:d.author_name||''});}catch{return json({title:'',uploader:''});}
      }
      const stream=path.match(/^\/api\/stream\/([\w-]{11})$/);
      if(stream && request.method==='GET'){
        const lookupStored = env.DEPLOYMENT === 'cloudflare' ? cloudStoredAudioStream : storedAudioStream;
        const storedStream = url.searchParams.has('external') ? {} : await lookupStored(env, stream[1]);
        if (storedStream.url) return json({available: true, url: storedStream.url, mimeType: 'audio/mpeg', storedAudio: 'available'});
        const fallbackUrl = 'https://www.youtube.com/watch?v=' + stream[1];
        const api = env.PIPED_API_URL?.trim().replace(/\/+$/, '');
        if (!api) return json({available: false, code: 'PIPED_NOT_CONFIGURED', fallbackUrl, ...storedStream});
        try{
          const d=await fetchJson(`${api}/streams/${stream[1]}`);
          const streams=(d.audioStreams||[]).filter(s=>typeof s.url==='string'&&s.url.startsWith('https://'));
          streams.sort((a,b)=>(Number(/audio\/(mp4|aac)/.test(b.mimeType||''))-Number(/audio\/(mp4|aac)/.test(a.mimeType||'')))||(Number(b.bitrate||0)-Number(a.bitrate||0)));
          if(!streams.length)throw new Error('Aucun flux disponible');
          return json({available:true,url:streams[0].url,mimeType:streams[0].mimeType||'',title:d.title||'',uploader:d.uploader||'',duration:d.duration||0});
        }catch{return json({available:false,code:'PIPED_UNAVAILABLE',fallbackUrl,...storedStream});}
      }
      if(path.startsWith('/api/'))return json({error:'Introuvable'},404);
      if(request.method!=='GET'&&request.method!=='HEAD')return json({error:'Méthode interdite'},405);
      const asset=ASSETS[path==='/'?'/index.html':path];
      if(!asset)return new Response('Introuvable',{status:404});
      return new Response(request.method==='HEAD'?null:asset.binary?Uint8Array.from(atob(asset.body), c => c.charCodeAt(0)):asset.body,{headers:{'Content-Type':asset.type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'}});
    }catch{return json({error:'Erreur du serveur. Réessaie dans un instant.'},500);}
  }
};
