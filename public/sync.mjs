const key = (...parts) => JSON.stringify(parts);
const modeTypes = new Set(['all', 'favorites', 'playlist', 'recording', 'offline']);

export function libraryRecords({favorites = [], playlists = []}, mode) {
  const records = {};
  for (const id of favorites) records[key('favorite', id)] = true;
  for (const playlist of playlists) {
    records[key('playlist', playlist.id)] = playlist.name;
    for (const entry of playlist.entries) records[key('member', playlist.id, entry)] = true;
  }
  if (modeTypes.has(mode?.type)) records[key('preference', 'listening')] = mode;
  return records;
}

export function libraryFromRecords(records) {
  const favorites = [];
  const playlists = new Map();
  const members = [];
  let mode;
  for (const [id, value] of Object.entries(records)) {
    if (value == null) continue;
    let parts;
    try { parts = JSON.parse(id); }
    catch { continue; }
    if (!Array.isArray(parts)) continue;
    const [type, item, entry] = parts;
    if (typeof item !== 'string') continue;
    if (type === 'favorite' && value === true) favorites.push(item);
    if (type === 'playlist' && typeof value === 'string') playlists.set(item, {id: item, name: value, entries: []});
    if (type === 'member' && value === true && typeof entry === 'string') members.push([item, entry]);
    if (type === 'preference' && item === 'listening' && modeTypes.has(value?.type)) mode = value;
  }
  for (const [id, entry] of members) playlists.get(id)?.entries.push(entry);
  return {favorites, playlists: [...playlists.values()], mode};
}

export function queueChanges(current, next, pending) {
  for (const id of new Set([...Object.keys(current), ...Object.keys(next)])) {
    const before = current[id] ?? null;
    const after = next[id] ?? null;
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      pending[id] = {value: after, id: crypto.randomUUID()};
    }
  }
}
