import {videoIdFromText} from './lib.mjs';
import {suggestStandard, youtubePlaylistId} from './listening.mjs';

const $ = id => document.getElementById(id);
export const youtubeThumbnail = id => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

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
      const suggested = existing ? standards.find(group => group.id === existing.standardId) : suggestStandard(title, standards);
      standard.replaceChildren(new Option('Nouveau standard', ''), ...[...standards]
        .sort((a, b) => a.title.localeCompare(b.title, 'fr')).map(group => new Option(group.title, group.id)));
      $('youtube-standard-fields').hidden = Boolean(reusable);
      standard.value = suggested?.id || '';
      const cleanedTitle = title.replace(/\s*[\[(](official (music )?video|official audio|lyrics|audio|video|hd)[\])]\s*/gi, ' ').trim();
      const parts = cleanedTitle.split(/\s+[-–—]\s+/);
      const channel = (uploader || '').replace(/\s+-\s+Topic$/i, '').toLowerCase();
      name.value = (parts.length > 1 && parts[0].toLowerCase() === channel ? parts.slice(1).join(' – ') : cleanedTitle).slice(0, 240);
      $('youtube-artist').value = (existing?.artist || uploader || '').slice(0, 240);
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

  return shared => {
    library.showImport();
    link.value = shared.slice(0, 4096);
    check();
  };
}
