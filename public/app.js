import {videoIdFromText,clock,mergeItems,keyLabels} from './lib.mjs';
import {shuffle} from './listening.mjs';
import {setupLibrary} from './library-ui.mjs';
import {parseLoudness, volumeForTrack} from './loudness.mjs';
import {setupAccount} from './account.mjs';
import {offlineAudio} from './offline.mjs';
import {youtubePlayer} from './youtube.mjs';

const $ = id => document.getElementById(id);
const STORAGE = 'heads-standards-v1';
const audio = $('audio');
const cover = $('player-cover');
let coverIds = [];
cover.addEventListener('load', () => { cover.hidden = false; });
cover.addEventListener('error', () => {
  cover.hidden = true;
  const next = coverIds.shift();
  if (next) cover.src = '/api/cover/' + next;
});
let coverSelection = '';
let items = loadLocal();
let sharedItems = [];

let currentId = null;
let isPlaying = false;
let duration = 0;
let currentTime = 0;
let operation = 0;
let syncTimer = null;
let syncBusy = false;
let syncQueued = false;
let advanceGuard = false;
let scope = [];
let storedAudioIds = new Set();
let playingStoredAudio = false;
let pending = [];
let historyIds = [];
let scopeLabel = '';
let positionReady = false;
let loudnessRecords = [];
let loudnessLoad;
let loudnessExpires = 0;

function applyTrackVolume(item) {
  if (item) audio.volume = volumeForTrack(item, loudnessRecords);
}

function loadSharedLoudness() {
  if (loudnessLoad && Date.now() < loudnessExpires) return loudnessLoad;
  loudnessExpires = Date.now() + 60000;
  loudnessLoad = (async () => {
    try {
      const response = await fetch('/api/loudness', {cache: 'no-store'});
      if (!response.ok) throw new Error();
      const {state, data} = await response.json();
      if (state === 'available') {
        try { loudnessRecords = parseLoudness(data); }
        catch { loudnessRecords = []; }
      } else if (state !== 'unavailable') {
        loudnessRecords = [];
      }
    } catch { /* Keep the last loaded adjustments. */ }
    applyTrackVolume(current());
  })();
  return loudnessLoad;
}
const defaultMode = {type: 'all'};
const library = setupLibrary({
  items: () => mergeItems(items, sharedItems),
  publicItems: () => sharedItems,
  listen, shareLink, notify, onChange: () => account.changed(),
});
const account = setupAccount(library, updatePlayerUi);
const localAudio = offlineAudio();
let offlineIds = new Set();
let objectUrl;
let autoplayPending = false;
let skippedVideos = 0;
let unloadAudio;
const video = youtubePlayer($('youtube-player'), {
  change(playing) {
    if (playing) {
      autoplayPending = false;
      skippedVideos = 0;
      notify('');
      const item = current();
      if (item) setupMedia(item);
    }
    setPlaying(playing);
  },
  blocked() {
    autoplayPending = true;
    notify('Appuie sur Lecture pour lancer l’enregistrement.');
  },
  ended() { if (video.active()) autoAdvance(); },
  error() {
    if (!video.active()) return;
    video.stop();
    positionReady = false;
    autoplayPending = false;
    setPlaying(false);
    if (scope.length > 1 && skippedVideos < Math.min(3, scope.length - 1)) {
      skippedVideos++;
      next();
      return;
    }
    notify('Cette version est à écouter sur YouTube.');
  },
});
let listeningMode = defaultMode;

function lastMode() { return account.mode() || defaultMode; }

function listen(versions, label, mode, gesture = true, autoplay = true) {
  const tracks = !navigator.onLine || mode.type === 'offline'
    ? versions.filter(track => offlineIds.has(track.id)) : versions;
  if (!tracks.length) {
    if (gesture) notify('Aucun enregistrement disponible dans ce mode.');
    return false;
  }
  skippedVideos = 0;
  listeningMode = mode;
  if (gesture) account.mode(mode);
  scope = [...new Set(tracks.map(version => version.id))];
  scopeLabel = label;
  historyIds = [];
  if (autoplay) {
    pending = shuffle(scope);
    playItem(pending.shift(), false, gesture);
  } else {
    currentId = scope[0];
    pending = shuffle(scope.slice(1));
    library.revealPlayingStandard(current()?.standardId);
    updatePlayerUi();
    notify('Appuie sur Lecture pour lancer l’enregistrement.');
  }
  return true;
}

function restoreMode(mode, gesture = false) {
  if (mode.type === 'offline' && listen(library.all(), 'Hors ligne', mode, gesture)) return;
  if (library.resume(mode, gesture)) return;
  if (mode.type !== 'all') library.resume(defaultMode, gesture);
}

async function refreshOffline() {
  try { offlineIds = new Set(await localAudio.keys()); }
  catch { offlineIds = new Set(); }
  updatePlayerUi();
}

function loadLocal() {
  try {
    const entries = JSON.parse(localStorage.getItem(STORAGE));
    if (Array.isArray(entries)) return entries.map(({start, end, startMarked, ...item}) => item);
  } catch { /* Start with an empty local collection. */ }
  return [];
}
function store() {localStorage.setItem(STORAGE,JSON.stringify(items));render();scheduleSync();}
function now() {return Date.now();}
function current() {return library.lookup(currentId);}
function otherVersion(item) {
  if (!item) return;
  const offlineOnly = !navigator.onLine || listeningMode.type === 'offline';
  const versions = library.versionsOf(item.standardId).filter(version => !offlineOnly || offlineIds.has(version.id));
  if (!versions.length) return;
  const index = versions.findIndex(version => version.id === item.id);
  const version = versions[(index + 1) % versions.length];
  if (version.id !== item.id) return version;
}
async function loadStoredAudio() {
  try {
    if (!navigator.onLine) return;
    const response = await fetch('/api/audio', {cache: 'no-store', signal: AbortSignal.timeout(4000)});
    const {ids} = await response.json();
    if (response.ok && Array.isArray(ids)) storedAudioIds = new Set(ids);
  } catch { /* Existing playback sources stay available. */ }
}
function render() {library.refresh();updatePlayerUi();}
function notify(message) {$('player-status').textContent=message;}

let shareFeedbackTimer;
async function shareLink(type, id, title) {
  const url = new URL('/', location.origin);
  url.searchParams.set(type, id);
  if (navigator.share) {
    try {
      await navigator.share({title, url: url.href});
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
    }
  }
  const feedback = $('share-status');
  clearTimeout(shareFeedbackTimer);
  feedback.textContent = '';
  try {
    await navigator.clipboard.writeText(url.href);
    feedback.textContent = 'Lien d’écoute copié.';
    shareFeedbackTimer = setTimeout(() => { feedback.textContent = ''; }, 3000);
  } catch {
    const field = $('share-url');
    field.value = url.href;
    const dialog = $('share-dialog');
    if (!dialog.open) dialog.showModal();
    field.select();
  }
}

function openListeningLink(type, id) {
  const versions = library.sharedVersions(type, id);
  const mode = {type: type === 'version' ? 'recording' : 'standard', id};
  return listen(versions, '', mode, false, false);
}

function updateCover(item) {
  const ids = [...new Set([item?.videoId, item?.previousYoutube, item?.duplicateYoutube])]
    .filter(id => /^[A-Za-z0-9_-]{11}$/.test(id || ''));
  const selection = ids.join(',');
  if (selection === coverSelection) return;
  coverSelection = selection;
  cover.hidden = true;
  const [first, ...fallbacks] = ids;
  coverIds = fallbacks;
  if (first) cover.src = '/api/cover/' + first;
  else cover.removeAttribute('src');
}

function itemUpdate(id,patch) {items=items.map(x=>x.id===id?{...x,...patch,updatedAt:now()}:x);store();updatePlayerUi();}
function safeInt(value) {return Number.isFinite(value)&&value>=0?value:0;}
function updatePlayerUi(){
  const item = current();
  updateCover(item);
  const display = [item?.artist, item?.album, item?.year, ...keyLabels({usualKey:item?.usualKey, versionKey:item?.key || item?.versionKey})].filter(Boolean).join(' · ');
  const favorite = $('favorite-track');
  const isFavorite = !!item && library.isFavorite(item.id);
  favorite.disabled = !item;
  favorite.setAttribute('aria-pressed', String(isFavorite));
  favorite.firstElementChild.textContent = isFavorite ? '★' : '☆';
  $('other-version').disabled = !otherVersion(item);
  $('share-version').disabled = !item || !library.publicRecording(item.id);
  $('current-title').textContent = item?.title || 'Aucun standard sélectionné';
  $('current-sub').textContent = item ? [display, scopeLabel].filter(Boolean).join(' · ') : 'Choisis quoi écouter dans la liste.';
  $('current-personnel').replaceChildren(...(item?.musicians || []).map(({name,instrument}) => {
    const musician = document.createElement('li');
    musician.textContent = name + ' — ' + instrument;
    return musician;
  }));
  $('current-personnel').hidden = !item?.musicians?.length;
  $('play').textContent = isPlaying ? '❚❚' : '▶';
  $('play').setAttribute('aria-label', isPlaying ? 'Mettre en pause' : 'Lire');
  $('engine-indicator').textContent = playingStoredAudio ? 'MP3' : video.active() ? 'YouTube' : objectUrl ? 'Hors ligne' : '';
  library.setPlaylistTrack(item);
  const max = Math.max(1, duration || 120);
  $('seek').max = String(max);
  $('seek').value = String(Math.min(max, safeInt(currentTime)));
  $('listen-all').setAttribute('aria-pressed', String(listeningMode.type === 'all'));
  $('listen-favorites').setAttribute('aria-pressed', String(listeningMode.type === 'favorites'));
  library.setActivePlaylist(listeningMode.type === 'playlist' ? listeningMode.id : undefined);
  $('seek').disabled = !positionReady;
  $('back-five').disabled = $('forward-five').disabled = !positionReady;
  $('time-current').textContent = clock(currentTime);
  $('time-end').textContent = clock(duration || 0);
  $('prev').disabled = !historyIds.length;
  $('next').disabled = !item || scope.length < 2;
  $('play').disabled = !item && !library.all().length;
}
async function addTrack(text, sharedTitle = '') {
  const videoId = videoIdFromText(text);
  if (!videoId) {notify('Lien YouTube invalide ou non reconnu.');return;}
  const existing = library.byVideo(videoId);
  if (existing) {listen([existing], existing.title, {type: 'recording', id: existing.id});return;}
  const title = sharedTitle.trim() || ('Vidéo ' + videoId);
  const id = crypto.randomUUID();
  items.push({id,videoId,title:title.slice(0,240),
    order:now(),updatedAt:now(),deleted:false});
  store();
  notify('Version ajoutée à la liste.');
  if (sharedTitle) return;
  try {
    const response = await fetch('/api/meta/' + videoId);
    const meta = await response.json();
    if (meta.title) itemUpdate(id, {title:meta.title.slice(0,240)});
  } catch { /* la version reste disponible */ }
}

function pause(){ if (video.active()) video.pause(); else audio.pause(); setPlaying(false); }
function setPlaying(playing) {
  const started = playing && !isPlaying;
  isPlaying = playing;
  if (started) library.revealPlayingStandard(current()?.standardId);
  updatePlayerUi();
}
function next() {
  if (!scope.length) return;
  if (!pending.length) pending = shuffle(scope, currentId);
  const id = pending.shift();
  if (currentId && currentId !== id) historyIds.push(currentId);
  playItem(id);
}
function prev() {
  const id = historyIds.pop();
  if (!id) return;
  if (currentId) pending.unshift(currentId);
  playItem(id);
}
function autoAdvance(){
  if (advanceGuard || (!positionReady && !video.active())) return;
  advanceGuard = true;
  if (scope.length === 1) {
    pause();
    seekTo(0);
  } else next();
}
async function playItem(id, skipStored = false, gesture = true) {
  const item = library.lookup(id);
  if (!item) return;
  const seq = ++operation;
  video.stop();
  unloadAudio?.();
  audio.pause();
  audio.removeAttribute('src');
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = undefined;
  currentId = item.id;
  currentTime = 0;
  duration = 0;
  isPlaying = false;
  positionReady = false;
  advanceGuard = false;
  autoplayPending = !gesture;
  const storedUrl = !skipStored && storedAudioIds.has(item.videoId) ? '/api/audio/' + item.videoId : null;
  playingStoredAudio = Boolean(storedUrl);
  $('youtube-fallback').hidden = true;
  notify('Chargement de l’audio…');
  updatePlayerUi();

  let storedAudioStatus = skipStored ? 'readFailed' : undefined;
  try {
    let url;
    if (offlineIds.has(item.id)) {
      const file = await localAudio.get(item.id);
      if (seq !== operation) return;
      if (file) url = objectUrl = URL.createObjectURL(file);
    }
    if (!url && !navigator.onLine) throw new Error('Hors ligne');
    if (!url) url = storedUrl || item.audioUrl;
    if (!url && item.videoId) {
      const response = await fetch('/api/stream/' + item.videoId + (skipStored ? '?external=1' : ''), {
        signal: AbortSignal.timeout(4500),
      });
      if (!response.ok) throw new Error('Flux audio indisponible');
      const stream = await response.json();
      if (seq !== operation) return;
      storedAudioStatus = stream.storedAudio || storedAudioStatus;
      if (stream.available !== false) {
        url = stream.url;
        if (stream.storedAudio === 'available') {
          playingStoredAudio = true;
          storedAudioIds.add(item.videoId);
        }
      }
    }
    if (!url) throw new Error('Audio indisponible');
    if (seq !== operation) return;
    playingStoredAudio = !objectUrl && playingStoredAudio;
    await loadAudio(url);
    if (seq !== operation) return;
    duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    positionReady = true;
    applyTrackVolume(item);
    await audio.play();
    if (seq !== operation) return;
    autoplayPending = false;
    skippedVideos = 0;
    setPlaying(true);
    notify('');
    setupMedia(item);
  } catch (error) {
    if (seq !== operation) return;
    if (error.name === 'NotAllowedError' && positionReady) {
      autoplayPending = true;
      notify('Appuie sur Lecture pour lancer l’audio.');
      updatePlayerUi();
      return;
    }
    if (playingStoredAudio && navigator.onLine) return playItem(item.id, true, gesture);
    if (item.videoId && navigator.onLine) {
      playingStoredAudio = false;
      video.load(item.videoId, true);
      showYouTubeLink(item);
      notify(gesture ? '' : 'Appuie sur Lecture si le navigateur bloque le démarrage.');
      updatePlayerUi();
      return;
    }
    autoplayPending = false;
    showAudioFallback(item, storedAudioStatus);
  }
}

function loadAudio(url) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      unloadAudio = undefined;
      audio.removeEventListener('loadedmetadata', ready);
      audio.removeEventListener('error', failed);
      clearTimeout(timer);
    };
    const ready = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error('Audio indisponible')); };
    const timer = setTimeout(failed, 13000);
    unloadAudio = failed;
    audio.addEventListener('loadedmetadata', ready);
    audio.addEventListener('error', failed);
    audio.src = url;
    audio.load();
  });
}

function showAudioFallback(item, storedAudioStatus) {
  positionReady = false;
  playingStoredAudio = false;
  setPlaying(false);
  const messages = {
    notUploaded: 'Aucun MP3 correspondant dans le stockage pour cette version.',
    storageUnavailable: 'Le stockage des MP3 est momentanément indisponible.',
    readFailed: 'Le MP3 a été trouvé, mais sa lecture a échoué.',
  };
  notify(messages[storedAudioStatus] || 'Audio indisponible pour cette version.');
  if (!navigator.onLine) notify('Cette version est indisponible hors connexion.');
  else showYouTubeLink(item);
}

function showYouTubeLink(item) {
  if (!item?.videoId) return;
  const link = $('youtube-fallback');
  link.href = 'https://www.youtube.com/watch?v=' + encodeURIComponent(item.videoId);
  link.hidden = false;
}

function togglePlay() {
  if (!current()) { restoreMode(lastMode(), true); return; }
  if (isPlaying) { pause(); return; }
  advanceGuard = false;
  if (video.active()) { video.play(); return; }
  if (positionReady) {
    audio.play().then(() => {setPlaying(true);notify('');}).catch(() => playItem(currentId));
  } else playItem(currentId);
}

function seekTo(value) {
  const seconds = Number(value);
  if (!positionReady || !Number.isFinite(seconds)) return;
  if (video.active()) video.seek(seconds);
  else if (audio.readyState) audio.currentTime = seconds;
  currentTime = seconds;
  updatePlayerUi();
}
function setupMedia(item){if(!('mediaSession' in navigator))return;
  navigator.mediaSession.metadata=new MediaMetadata({title:item.title,artist:item.artist || 'Jazz Legacy',artwork:[{src:'/icon.png',type:'image/png'}]});
  for(const [action,handler] of Object.entries({play:togglePlay,pause:pause,nexttrack:next,previoustrack:prev,seekto:e=>seekTo(e.seekTime)})){
    try{navigator.mediaSession.setActionHandler(action,handler);}catch{}
  }
}
audio.addEventListener('ended',autoAdvance);
audio.addEventListener('pause',()=>setPlaying(false));
audio.addEventListener('play',()=>setPlaying(true));
audio.addEventListener('error',()=>{if (positionReady && !video.active()) playItem(currentId, true);});
setInterval(()=>{
  if(positionReady && !video.active() && audio.readyState>0){currentTime=audio.currentTime;duration=Number.isFinite(audio.duration)?audio.duration:duration;}
  if (video.active()) {
    const time = video.time();
    if (time?.duration && !positionReady) {
      positionReady = true;
      updatePlayerUi();
    }
    if (time) ({currentTime, duration} = time);
  }
  $('time-current').textContent = clock(currentTime);
  $('time-end').textContent = clock(duration);
  $('seek').max = String(Math.max(1, duration || 120));
  $('seek').value = String(Math.min(Number($('seek').max), safeInt(currentTime)));
},250);

function scheduleSync(){clearTimeout(syncTimer);syncTimer=setTimeout(syncNow,750);}
async function syncNow(){
  if(!navigator.onLine)return;
  if(syncBusy){syncQueued=true;return;}syncBusy=true;
  try{
    for(let attempt=0;attempt<4;attempt++){
      const remoteRes=await fetch('/api/data',{cache:'no-store'});
      const remote=await remoteRes.json();
      if(!remoteRes.ok)throw new Error(remote.error||`Erreur ${remoteRes.status}`);
      sharedItems = remote.items;
      if (!remote.canEdit) { render(); return; }
      const merged=mergeItems(items,sharedItems);
      items=merged;localStorage.setItem(STORAGE,JSON.stringify(items));render();
      // Une égalité ne nécessite pas d'écriture serveur.
      const normalize=arr=>JSON.stringify([...arr].sort((a,b)=>a.id.localeCompare(b.id)));
      if(normalize(merged)===normalize(remote.items))return;
      const put=await fetch('/api/data',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:remote.version,items:merged})});
      if(put.status===409)continue;
      const saved=await put.json();if(!put.ok)throw new Error(saved.error||'Écriture impossible');
      return;
    }
    throw new Error('Modification simultanée : réessaie.');
  }catch(e){console.warn('Catalogue',e.message);}
  finally{syncBusy=false;if(syncQueued){syncQueued=false;scheduleSync();}}
}
$('play').addEventListener('click', togglePlay);
$('next').addEventListener('click', () => { skippedVideos = 0; next(); });
$('prev').addEventListener('click', () => { skippedVideos = 0; prev(); });
$('other-version').addEventListener('click', () => {
  const version = otherVersion(current());
  if (!version) return;
  if (listeningMode.type === 'recording') {
    library.resume({type: 'recording', id: version.id});
    return;
  }
  skippedVideos = 0;
  historyIds.push(currentId);
  pending = pending.filter(id => id !== version.id);
  playItem(version.id);
});
$('seek').addEventListener('input',e=>seekTo(e.target.value));
function jumpBy(delta) {
  if (!positionReady) return;
  seekTo(Math.max(0, Math.min(duration || Infinity, currentTime + delta)));
}
$('back-five').addEventListener('click', () => jumpBy(-5));
$('forward-five').addEventListener('click', () => jumpBy(5));
$('share-version').addEventListener('click', () => {
  const version = library.publicRecording(currentId);
  if (version) shareLink('version', version.id, [version.title, version.artist].filter(Boolean).join(' – '));
});
$('favorite-track').addEventListener('click', () => {
  const item = current();
  if (!item) return;
  library.toggleFavorite(item.id);
  updatePlayerUi();
});
document.addEventListener('keydown',e=>{if(e.code==='Space'&&!['INPUT','TEXTAREA','SELECT','BUTTON'].includes(document.activeElement?.tagName)&&!document.activeElement?.closest('textarea, summary, a')&&!document.querySelector('dialog[open]')){e.preventDefault();togglePlay();}});
window.addEventListener('online', () => {updatePlayerUi(); syncNow(); loadStoredAudio(); loadSharedLoudness();});
window.addEventListener('jazz-session-changed', () => {
  loudnessExpires = 0;
  loadStoredAudio();
  loadSharedLoudness();
});
window.addEventListener('offline', updatePlayerUi);
document.addEventListener('visibilitychange', () => {if (!document.hidden) syncNow();});
document.addEventListener('click', event => {
  if (!autoplayPending || isPlaying || !(video.active() || positionReady)) return;
  if (event.target.closest('#play, #prev, #next, #favorite-track, #other-version, #listen-all, #listen-favorites, #playlist-listen, #share-version, .standard-choice, .standard-share, .version-share, a, dialog')) return;
  autoplayPending = false;
  togglePlay();
});
// Android : NewPipe → Partager → Jazz Legacy. Android transmet souvent le lien dans « text ».
const query=new URLSearchParams(location.search);const shared=query.get('url')||query.get('text')||'';
const sharedType = query.has('version') ? 'version' : query.has('standard') ? 'standard' : null;
const audioIndexReady = Promise.race([loadStoredAudio(), new Promise(resolve => setTimeout(resolve, 500))]);
render();
const sharedCatalogueReady = syncNow();
Promise.all([library.load(), refreshOffline(), account.ready(), audioIndexReady]).then(async () => {
  updatePlayerUi();
  if (sharedType) {
    const id = query.get(sharedType);
    if (current() || openListeningLink(sharedType, id)) return;
    await sharedCatalogueReady;
    if (current() || openListeningLink(sharedType, id)) return;
    notify(navigator.onLine ? 'Ce lien d’écoute ne correspond à aucun enregistrement disponible.'
      : 'Ce lien d’écoute est indisponible hors connexion.');
  } else if (shared && videoIdFromText(shared)) {
    history.replaceState(null,'',location.pathname);
    addTrack(shared,query.get('title') || '');
  } else if (!current()) restoreMode(lastMode());
});
loadSharedLoudness();
if('serviceWorker' in navigator&&window.isSecureContext)navigator.serviceWorker.register('/sw.js').catch(()=>{});
