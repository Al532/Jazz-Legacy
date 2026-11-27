import {videoIdFromText} from './lib.mjs';
import {normalTitle, suggestStandard, youtubePlaylistId} from './listening.mjs';

const $ = id => document.getElementById(id);
export const youtubeThumbnail = id => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
const watchUrl = id => `https://www.youtube.com/watch?v=${id}`;

const jazzArtistAliases = {
  'Bill Evans': ['Bill Evans Trio', 'The Bill Evans Trio'],
  'Charlie Parker': ['Charlie “Bird” Parker'],
  'Dizzy Gillespie': [],
  'Duke Ellington': [],
  'Ella Fitzgerald': [],
  'Freddie Hubbard': [],
  'Herbie Hancock': [],
  'John Coltrane': ['John Coltrane Quartet', 'The John Coltrane Quartet'],
  'Miles Davis': ['Miles Davis Quintet', 'The Miles Davis Quintet'],
  'Oscar Peterson': ['Oscar Peterson Trio', 'The Oscar Peterson Trio'],
  'Sonny Rollins': [],
  'Thelonious Monk': [],
};

export function sharedYouTubeInput(params) {
  const fields = ['url', 'text', 'title'].flatMap(key => params.getAll(key)).map(value => value.trim()).filter(Boolean);
  for (const field of fields) {
    const id = videoIdFromText(field, {youtubeLink: true});
    if (id) return watchUrl(id);
  }
  return fields[0] || '';
}

export function suggestYouTubeMetadata(title, uploader, standards) {
  const cleanedTitle = title.replace(/\s*[\[(](official (music )?video|official audio|lyrics|audio|video|hd)[\])]\s*/gi, ' ').trim();
  const channel = (uploader || '').trim();
  const topicChannel = /\s+[-–—]\s+Topic$/i.test(channel);
  const channelArtist = channel.replace(/\s+[-–—]\s+Topic$/i, '');
  const artists = new Map();
  for (const standard of standards) {
    for (const {artist} of standard.versions || []) {
      if (artist?.trim()) artists.set(normalTitle(artist), artist.trim());
    }
  }
  for (const [artist, aliases] of Object.entries(jazzArtistAliases)) {
    for (const name of [artist, ...aliases]) artists.set(normalTitle(name), name);
  }
  const knownArtist = value => {
    const key = normalTitle(value);
    return key ? artists.get(key) || (key === normalTitle(channelArtist) ? channelArtist : '') : '';
  };

  const parts = cleanedTitle.split(/(\s*[:|–—]\s*|\s+-\s+|\s+(?:by|par)\s+)/i);
  let name = cleanedTitle;
  let artist = '';
  if (parts.length > 1) {
    const first = knownArtist(parts[0]);
    const last = knownArtist(parts.at(-1));
    if (first && !last) {
      artist = first;
      name = parts.slice(2).join('');
    } else if (last && !first) {
      artist = last;
      name = parts.slice(0, -2).join('');
    }
  }
  artist ||= artists.get(normalTitle(channelArtist)) || (topicChannel ? channelArtist : '');
  return {name: name.trim() || cleanedTitle, artist};
}

export function setupYouTubeImport(library, ready) {
  const link = $('youtube-link');
  const status = $('youtube-import-status');
  const form = $('youtube-save-form');
  const standard = $('youtube-standard');
  const name = $('youtube-standard-name');
  const destination = $('youtube-playlist');
  let checked;
  let request;

  function reset() {
    request?.abort();
    checked = undefined;
    form.hidden = true;
    status.textContent = '';
  }

  standard.onchange = () => {
    $('youtube-new-standard').hidden = Boolean(standard.value);
    name.required = !standard.value && !$('youtube-standard-fields').hidden;
  };

  function fillPlaylists() {
    const {playlists} = library.importOptions();
    const defaultPlaylist = playlists.find(playlist => playlist.id === youtubePlaylistId);
    destination.replaceChildren(new Option(defaultPlaylist?.name || 'Liens YouTube', youtubePlaylistId),
      ...playlists.filter(playlist => playlist.id !== youtubePlaylistId).map(({name, id}) => new Option(name, id)));
  }

  async function check() {
    reset();
    const videoId = videoIdFromText(link.value, {youtubeLink: true});
    if (!videoId) { status.textContent = 'Indique un lien vers une vidéo YouTube.'; return; }
    const controller = new AbortController();
    request = controller;
    status.textContent = 'Vérification auprès de YouTube…';
    try {
      const response = await fetch('/api/meta/' + videoId, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (response.status === 404) {
        status.textContent = 'YouTube ne fournit pas les informations de cette vidéo. Elle est peut-être privée, supprimée ou restreinte.';
        return;
      }
      if (!response.ok) throw new Error();
      const {title, uploader} = await response.json();
      if (!title) throw new Error();
      await ready;
      if (controller.signal.aborted) return;
      const existing = library.byVideo(videoId);
      const reusable = existing && (library.publicRecording(existing.id) || existing.youtubeImportId) ? existing : undefined;
      const {standards} = library.importOptions();
      const metadata = suggestYouTubeMetadata(title, uploader, standards);
      const suggested = existing ? standards.find(group => group.id === existing.standardId) : suggestStandard(metadata.name, standards);
      standard.replaceChildren(new Option('Nouveau standard', ''), ...[...standards]
        .sort((a, b) => a.title.localeCompare(b.title, 'fr')).map(group => new Option(group.title, group.id)));
      $('youtube-standard-fields').hidden = Boolean(reusable);
      standard.value = suggested?.id || '';
      name.value = metadata.name.slice(0, 240);
      $('youtube-artist').value = (existing?.artist || metadata.artist).slice(0, 240);
      standard.onchange();
      fillPlaylists();
      $('youtube-preview-title').textContent = title;
      $('youtube-preview-channel').textContent = uploader || '';
      $('youtube-preview-cover').src = youtubeThumbnail(videoId);
      checked = {videoId, title, reusable};
      status.textContent = reusable ? `Version déjà référencée sous « ${existing.title} ».` :
        suggested ? `Standard suggéré d’après le titre : ${suggested.title}.` : 'Vérifie le nom du standard proposé.';
      form.hidden = false;
    } catch {
      if (!controller.signal.aborted) status.textContent = navigator.onLine ?
        'Impossible de vérifier la vidéo pour le moment. Réessaie.' : 'Connecte-toi à Internet pour vérifier cette vidéo.';
    }
  }

  $('youtube-link-form').onsubmit = event => { event.preventDefault(); check(); };
  link.oninput = reset;
  link.onpaste = event => {
    const videoId = videoIdFromText(event.clipboardData?.getData('text/plain'), {youtubeLink: true});
    if (!videoId) return;
    event.preventDefault();
    link.value = watchUrl(videoId);
    reset();
  };
  form.onsubmit = event => {
    event.preventDefault();
    if (!checked) return;
    const {videoId, title, reusable} = checked;
    const group = library.importOptions().standards.find(entry => entry.id === standard.value);
    if (!reusable && standard.value && !group) {
      status.textContent = 'Ce standard n’est plus disponible. Vérifie à nouveau le lien.';
      return;
    }
    const standardTitle = group?.title || name.value.trim();
    if (!reusable && !standardTitle) { status.textContent = 'Indique le nom du standard.'; return; }
    const id = reusable?.youtubeImportId || `youtube:${videoId}`;
    const time = Date.now();
    const item = reusable?.youtubeImportId ? undefined : {id, videoId, title: reusable?.title || standardTitle,
      youtubeTitle: title.slice(0, 240), artist: reusable?.artist || $('youtube-artist').value.trim(),
      standardId: reusable?.standardId || group?.id, order: time, updatedAt: time};
    try {
      if (library.saveImport({versionId: id, item, destination: destination.value})) {
        link.value = '';
        reset();
      }
      else { fillPlaylists(); status.textContent = 'Choisis une playlist disponible.'; }
    } catch { status.textContent = 'Impossible d’enregistrer la version sur cet appareil. Réessaie.'; }
  };

  return params => {
    library.showImport();
    link.value = sharedYouTubeInput(params).slice(0, 4096);
    check();
  };
}
