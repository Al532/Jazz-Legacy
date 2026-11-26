import {visibleItems} from './lib.mjs';

function recordingYear({year}) {
  const value = Number(year);
  return Number.isInteger(value) && value > 0 ? value : Number.MAX_SAFE_INTEGER;
}

export function buildLibrary(catalogue, items) {
  const personal = new Map(visibleItems(items).map(item => [item.videoId, item]));
  const linked = new Set();
  const groups = catalogue.map(standard => {
    const recordings = (standard.versions || []).map((version, index) => {
      const videoId = version.youtube || null;
      const audioUrl = version.audioUrl || null;
      if (videoId) linked.add(videoId);
      if (version.previousYoutube) linked.add(version.previousYoutube);
      if (version.duplicateYoutube) linked.add(version.duplicateYoutube);
      const saved = personal.get(videoId) || personal.get(version.previousYoutube) || personal.get(version.duplicateYoutube);
      const recordingId = version.previousYoutube || videoId || version.id || index;
      return {
        ...version, id: `${standard.id}:${recordingId}`,
        legacyId: version.duplicateYoutube ? `${standard.id}:${version.duplicateYoutube}` : undefined,
        standardId: standard.id, title: standard.title, lyrics: version.lyrics || standard.lyrics, usualKey: standard.usualKey || saved?.usualKey,
        key: version.key || saved?.versionKey,
        videoId, audioUrl, savedId: saved?.id,
        youtubeImportId: saved?.id === `youtube:${saved?.videoId}` ? saved.id : undefined,
        importVideoId: saved?.id === `youtube:${saved?.videoId}` ? saved.videoId : undefined,
      };
    });
    return {...standard, recordings};
  });
  const groupsById = new Map(groups.map(group => [group.id, group]));
  const custom = new Map();
  const visible = visibleItems(items);
  const importedVideos = new Map(visible.filter(item => item.id === `youtube:${item.videoId}`).map(item => [item.videoId, item]));
  const legacyVideos = new Map(visible.filter(item => importedVideos.get(item.videoId) !== item)
    .map(item => [item.videoId, item.id]));
  for (const item of visible) {
    if (linked.has(item.videoId)) continue;
    const imported = importedVideos.get(item.videoId);
    if (imported && imported !== item) continue;
    const key = item.title.toLocaleLowerCase('fr').trim();
    const group = groupsById.get(item.standardId) || [...custom.values()].find(entry => entry.id === item.standardId) || custom.get(key) || {
      id: item.standardId?.startsWith('custom:') ? item.standardId : `custom:${item.id}`, title: item.title, recordings: [],
    };
    if (!groupsById.has(group.id)) custom.set(key, group);
    const {start, end, startMarked, ...metadata} = item;
    group.recordings.push({
      ...metadata, id: item.id, savedId: item.id, standardId: group.id, title: group.title, lyrics: item.lyrics || group.lyrics,
      youtubeImportId: imported?.id, importVideoId: imported?.videoId,
      legacyId: imported ? item.legacyId || legacyVideos.get(item.videoId) : item.legacyId,
      usualKey: item.usualKey || group.usualKey, key: item.versionKey,
    });
  }
  const library = [...groups, ...custom.values()];
  for (const group of library) {
    group.recordings.sort((a, b) => recordingYear(a) - recordingYear(b));
  }
  return library;
}

export const youtubePlaylistId = 'youtube-imports';

export function addPlaylistVersion(playlists, playlistId, versionId) {
  let playlist = playlists.find(entry => entry.id === playlistId);
  if (!playlist && playlistId === youtubePlaylistId) {
    playlist = {id: youtubePlaylistId, name: 'Liens YouTube', entries: []};
    playlists.push(playlist);
  }
  if (!playlist) return false;
  const ref = `version:${versionId}`;
  if (!playlist.entries.includes(ref)) playlist.entries.push(ref);
  return true;
}

export function keepImportsInPlaylists(playlists, imports) {
  const members = new Set(playlists.flatMap(playlist => playlist.entries));
  for (const item of imports) {
    if (!members.has(`version:${item.id}`)) addPlaylistVersion(playlists, youtubePlaylistId, item.id);
  }
}

const normalTitle = title => String(title || '').normalize('NFD').replace(/\p{M}/gu, '')
  .toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function suggestStandard(title, standards) {
  const source = normalTitle(title);
  let match;
  let best = 0;
  let tied = false;
  for (const standard of standards) {
    for (const alias of [standard.title, ...(standard.aliases || [])]) {
      const candidate = normalTitle(alias);
      if (!candidate || !(source === candidate || (candidate.length >= 4 && ` ${source} `.includes(` ${candidate} `)))) continue;
      const score = candidate.length + (source === candidate ? source.length : 0);
      if (score > best) { match = standard; best = score; tied = false; }
      else if (score === best && match.id !== standard.id) tied = true;
    }
  }
  return tied ? undefined : match;
}

export function playable(group) {
  return group.recordings.filter(version => version.audioUrl || version.videoId);
}

export function playlistRecordings(groups, entries) {
  const ids = new Set(entries);
  return groups.flatMap(group => playable(group).filter(
    version => ids.has(`standard:${group.id}`) || ids.has(`version:${version.id}`) ||
      (version.legacyId && ids.has(`version:${version.legacyId}`)) ||
      (version.youtubeImportId && ids.has(`version:${version.youtubeImportId}`)),
  ));
}

export function shuffle(ids, previous = null, random = Math.random) {
  const result = [...new Set(ids)];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  if (result.length > 1 && result[0] === previous) result.push(result.shift());
  return result;
}

export function groupByStandard(tracks) {
  const groups = new Map();
  for (const track of tracks) {
    const standardId = track.standardId || track.id;
    if (!groups.has(standardId)) groups.set(standardId, []);
    groups.get(standardId).push(track);
  }
  return groups;
}

export function shuffleStandards(groups, previous, hasAudio, random = Math.random) {
  return shuffle(groups.keys(), previous, random).map(standardId => {
    const versions = groups.get(standardId);
    const ready = versions.filter(hasAudio);
    const candidates = ready.length ? ready : versions;
    return candidates[Math.floor(random() * candidates.length)].id;
  });
}
