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
      };
    });
    return {...standard, recordings};
  });
  const groupsById = new Map(groups.map(group => [group.id, group]));
  const custom = new Map();
  for (const item of visibleItems(items)) {
    if (linked.has(item.videoId)) continue;
    const key = item.title.toLocaleLowerCase('fr').trim();
    const group = groupsById.get(item.standardId) || [...custom.values()].find(entry => entry.id === item.standardId) || custom.get(key) || {
      id: `custom:${item.id}`, title: item.title, recordings: [],
    };
    if (!groupsById.has(group.id)) custom.set(key, group);
    const {start, end, startMarked, ...metadata} = item;
    group.recordings.push({
      ...metadata, id: item.id, savedId: item.id, standardId: group.id, title: group.title, lyrics: item.lyrics || group.lyrics,
      usualKey: item.usualKey || group.usualKey, key: item.versionKey,
    });
  }
  const library = [...groups, ...custom.values()];
  for (const group of library) {
    group.recordings.sort((a, b) => recordingYear(a) - recordingYear(b));
  }
  return library;
}

export function playable(group) {
  return group.recordings.filter(version => version.audioUrl || version.videoId);
}

export function playlistRecordings(groups, entries) {
  const ids = new Set(entries);
  return groups.flatMap(group => playable(group).filter(
    version => ids.has(`standard:${group.id}`) || ids.has(`version:${version.id}`) ||
      (version.legacyId && ids.has(`version:${version.legacyId}`)),
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
