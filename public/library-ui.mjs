import {buildLibrary, playable, playlistRecordings} from './listening.mjs';

const catalogueStorage = 'heads.catalogue.personal.v1';
const playlistsStorage = 'heads.playlists.v1';
const get = id => document.getElementById(id);
const read = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
};

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function action(label, onClick, disabled = false) {
  const button = element('button', label, 'btn-outline');
  button.type = 'button';
  button.disabled = disabled;
  button.addEventListener('click', onClick);
  return button;
}

function shareAction(label, className, onClick) {
  const button = action('', onClick);
  button.className = 'share-button ' + className;
  button.setAttribute('aria-label', label);
  button.title = label;
  return button;
}

export function setupLibrary({items, publicItems, listen, shareLink, notify, onChange}) {
  let base = [];
  let cataloguePromise;
  const personal = read(catalogueStorage, {});
  const trackFavorites = new Set(personal.trackFavorites || []);
  const legacyFavorites = new Set(personal.favorites || []);
  let playlists = read(playlistsStorage, []);
  let guest = true;
  let groups = [];
  let publicStandards = new Map();
  let publicRecordings = new Map();
  let playlistId = '';
  let activePlaylist;
  const list = get('items');
  const search = get('search');
  let playlistTrack;
  let openGroupId;
  let playingGroupId;
  let view = 'standards';
  const selected = () => playlists.find(playlist => playlist.id === playlistId);
  const all = () => groups.flatMap(playable);
  const isFavoriteTrack = track => track && (trackFavorites.has(track.id) || trackFavorites.has(track.legacyId));
  const favorites = () => all().filter(isFavoriteTrack);
  const normalize = text => String(text || '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr');

  function migrateFavorites() {
    if (!guest) return;
    let migrated = false;
    for (const group of groups) {
      const tracks = playable(group);
      if (!tracks.length || !legacyFavorites.delete(group.id)) continue;
      for (const track of tracks) trackFavorites.add(track.id);
      migrated = true;
    }
    if (migrated && guest) save();
  }

  function save() {
    if (guest) {
      localStorage.setItem(catalogueStorage, JSON.stringify({
        ...personal, favorites: [...legacyFavorites], trackFavorites: [...trackFavorites],
      }));
      localStorage.setItem(playlistsStorage, JSON.stringify(playlists));
    }
    onChange();
  }

  function refresh() {
    const catalogue = [...base, ...(personal.standards || [])].map(standard => ({
      ...standard,
      versions: [...(standard.versions || []), ...(personal.versions?.[standard.id] || [])]
        .filter((version, index, versions) => !version.youtube ||
          versions.findIndex(entry => entry.youtube === version.youtube) === index),
    }));
    groups = buildLibrary(catalogue, items());
    publicStandards = new Map();
    publicRecordings = new Map();
    for (const group of buildLibrary(base, publicItems())) {
      const versions = playable(group);
      if (!versions.length) continue;
      publicStandards.set(group.id, versions);
      for (const version of versions) {
        publicRecordings.set(version.id, version);
        if (version.legacyId) publicRecordings.set(version.legacyId, version);
      }
    }
    migrateFavorites();
    render();
  }

  function renderPlaylists() {
    const select = get('playlist-select');
    select.replaceChildren(new Option('Choisir une playlist', ''),
      ...playlists.map(playlist => new Option(playlist.name, playlist.id)));
    select.value = playlistId;
    const playlist = selected();
    get('playlist-listen').setAttribute('aria-pressed', String(playlistId === activePlaylist));
    get('playlist-listen').disabled = !playlist || !playlistRecordings(groups, playlist.entries).length;
    get('playlist-rename').disabled = !playlist;
    get('playlist-delete').disabled = !playlist;
    showMembership();
  }

  function showMembership() {
    const playlist = selected();
    get('playlist-membership').hidden = !playlist || !playlistTrack;
    if (!playlist || !playlistTrack) return;
    const {id, legacyId, standardId} = playlistTrack;
    for (const [buttonId, refs, label] of [
      ['playlist-track', [`version:${id}`, ...(legacyId ? [`version:${legacyId}`] : [])], 'la version en cours'],
      ['playlist-standard', [`standard:${standardId}`], 'le standard en cours'],
    ]) {
      const button = get(buttonId);
      const added = refs.some(ref => playlist.entries.includes(ref));
      button.textContent = (added ? 'Retirer ' : 'Ajouter ') + label;
      button.setAttribute('aria-pressed', String(added));
      button.onclick = () => {
        if (added) playlist.entries = playlist.entries.filter(entry => !refs.includes(entry));
        else playlist.entries.push(refs[0]);
        save();
        renderPlaylists();
      };
    }
  }

  function render() {
    const query = normalize(search.value.trim());
    const showingFavorites = view === 'favorites';
    const visibleGroups = showingFavorites ? groups.flatMap(group => {
      const recordings = playable(group).filter(isFavoriteTrack);
      return recordings.length ? [{...group, recordings}] : [];
    }) : groups;
    const candidates = visibleGroups.filter(group => !query || normalize([
      group.title, group.composer, ...(group.aliases || []),
      ...group.recordings.flatMap(version => [version.artist, version.album]),
    ].join(' ')).includes(query));
    const versionCount = candidates.reduce((total, group) => total + group.recordings.length, 0);
    get('count').textContent = `${candidates.length} (${versionCount} ${versionCount === 1 ? 'version' : 'versions'})`;
    get('listen-all').disabled = !all().length;
    get('listen-favorites').disabled = !favorites().length;
    renderPlaylists();
    const rows = document.createDocumentFragment();
    for (const group of candidates) {
      const row = element('article', '', 'standard-row');
      const details = element('details');
      details.name = 'jazz-standard';
      details.dataset.standardId = group.id;
      details.open = openGroupId === group.id;
      details.addEventListener('toggle', () => {
        if (!details.isConnected) return;
        if (details.open) openGroupId = group.id;
        else if (openGroupId === group.id) openGroupId = undefined;
      });
      const summary = element('summary');
      summary.setAttribute('aria-label', group.title);
      const heading = element('span', '', 'standard-heading');
      heading.append(element('span', group.title));
      if (publicStandards.has(group.id)) {
        heading.append(shareAction('Partager le standard ' + group.title, 'standard-share', event => {
          event.preventDefault();
          event.stopPropagation();
          shareLink('standard', group.id, group.title);
        }));
      }
      summary.append(heading);
      if (playingGroupId === group.id) summary.setAttribute('aria-current', 'true');
      details.append(summary);
      const versions = playable(group);
      if (versions.length) {
        const choices = element('ul', '', 'standard-choices');
        for (const version of versions) {
          const row = element('li');
          const label = [version.artist || 'Artiste inconnu', version.year].filter(Boolean).join(' – ');
          const button = action(label, () => resume({type: 'recording', id: version.id}));
          button.className = 'standard-choice';
          button.setAttribute('aria-label', 'Écouter ' + label);
          row.append(button);
          if (publicRecordings.has(version.id)) {
            const share = shareAction('Partager la version de ' + label, 'version-share',
              () => shareLink('version', version.id, group.title + ' – ' + label));
            row.append(share);
          }
          choices.append(row);
        }
        details.append(choices);
      } else details.append(element('p', 'Aucune version à écouter.', 'standard-unavailable'));
      row.append(details);
      rows.append(row);
    }
    const emptyMessage = showingFavorites && !visibleGroups.length ? 'Aucun enregistrement favori.' : 'Aucun standard trouvé.';
    list.replaceChildren(candidates.length ? rows : element('p', emptyMessage, 'empty'));
  }

  function markPlayingStandard(standardId) {
    if (playingGroupId === standardId) return;
    playingGroupId = standardId;
    list.querySelector('summary[aria-current]')?.removeAttribute('aria-current');
    if (standardId) list.querySelector(`[data-standard-id="${CSS.escape(standardId)}"] > summary`)?.setAttribute('aria-current', 'true');
  }

  function resume(mode, gesture = true) {
    if (mode.type === 'all') return listen(all(), 'Standards au hasard', mode, gesture);
    if (mode.type === 'favorites') return listen(favorites(), 'Favoris', mode, gesture);
    if (mode.type === 'recording') {
      const track = lookup(mode.id);
      return track ? listen([track], '', mode, gesture) : false;
    }
    if (mode.type === 'playlist') {
      const playlist = playlists.find(entry => entry.id === mode.id);
      if (!playlist) return false;
      playlistId = playlist.id;
      renderPlaylists();
      return listen(playlistRecordings(groups, playlist.entries), playlist.name, mode, gesture);
    }
    return false;
  }

  get('listen-all').onclick = () => resume({type: 'all'});
  get('listen-favorites').onclick = () => resume({type: 'favorites'});
  get('playlist-select').onchange = event => { playlistId = event.target.value; renderPlaylists(); };
  get('playlist-listen').onclick = () => resume({type: 'playlist', id: playlistId});
  get('playlist-new').onclick = () => {
    const name = prompt('Nom de la playlist')?.trim();
    if (!name) return;
    playlistId = crypto.randomUUID();
    playlists.push({id: playlistId, name: name.slice(0, 100), entries: []});
    save();
    render();
  };
  get('playlist-rename').onclick = () => {
    const playlist = selected();
    if (!playlist) return;
    const name = prompt('Nouveau nom', playlist.name)?.trim();
    if (!name) return;
    playlist.name = name.slice(0, 100);
    save();
    renderPlaylists();
  };
  get('playlist-delete').onclick = () => {
    if (!selected() || !confirm(`Supprimer la playlist « ${selected().name} » ?`)) return;
    playlists = playlists.filter(playlist => playlist.id !== playlistId);
    playlistId = '';
    save();
    render();
  };
  const navigation = document.querySelectorAll('[data-library]');
  for (const button of navigation) button.addEventListener('click', () => {
    if (view === button.dataset.library) return;
    const nextView = button.dataset.library;
    if (nextView !== 'playlists') search.value = '';
    view = nextView;
    for (const item of navigation) item.setAttribute('aria-pressed', String(item === button));
    get('collection').hidden = view === 'playlists';
    get('playlists').hidden = view !== 'playlists';
    if (view !== 'playlists') {
      get('collection-title').textContent = view === 'favorites' ? 'Favoris' : 'Standards';
      get('listen-favorites').hidden = view !== 'favorites';
      render();
    }
  });
  search.addEventListener('input', render);
  const lookup = id => id ? all().find(version => version.id === id || version.legacyId === id) || null : null;
  return {
    all, lookup, refresh, markPlayingStandard,
    publicRecording: id => publicRecordings.get(id),
    sharedVersions(type, id) {
      if (type === 'standard') return (publicStandards.get(id) || []).map(version => lookup(version.id)).filter(Boolean);
      const track = publicRecordings.get(id);
      const version = track && lookup(track.id);
      return version ? [version] : [];
    },
    versionsOf(standardId) {
      const group = groups.find(entry => entry.id === standardId);
      return group ? playable(group) : [];
    },
    setActivePlaylist(id) {
      activePlaylist = id;
      get('playlist-listen').setAttribute('aria-pressed', String(playlistId === activePlaylist));
    },
    setPlaylistTrack(item) {
      if (playlistTrack?.id === item?.id && playlistTrack?.standardId === item?.standardId) return;
      playlistTrack = item;
      showMembership();
    },
    byVideo: id => all().find(version => version.videoId === id),
    isFavorite: id => Boolean(isFavoriteTrack(lookup(id))),
    toggleFavorite(id) {
      const track = lookup(id);
      if (!track) return;
      if (isFavoriteTrack(track)) {
        trackFavorites.delete(track.id);
        trackFavorites.delete(track.legacyId);
      } else trackFavorites.add(track.id);
      save();
      get('listen-favorites').disabled = !favorites().length;
      if (view === 'favorites') render();
    },
    resume,
    state: () => ({favorites: [...trackFavorites], playlists: structuredClone(playlists)}),
    setState(state, isGuest) {
      guest = isGuest;
      trackFavorites.clear();
      for (const id of state.favorites || []) trackFavorites.add(id);
      playlists = structuredClone(state.playlists || []);
      if (!selected()) playlistId = '';
      refresh();
    },
    guestState() {
      const saved = read(catalogueStorage, {});
      const favorites = new Set(saved.trackFavorites || []);
      const standardIds = new Set(saved.favorites || []);
      for (const group of groups) if (standardIds.has(group.id)) {
        for (const track of playable(group)) favorites.add(track.id);
      }
      return {favorites: [...favorites], playlists: read(playlistsStorage, [])};
    },
    load() {
      cataloguePromise ||= (async () => {
        try {
          const response = await fetch('./catalogue-data.json');
          if (!response.ok) throw new Error();
          base = (await response.json()).standards;
        } catch { notify('Le catalogue des standards est indisponible.'); }
        refresh();
      })();
      return cataloguePromise;
    },
  };
}
