import {videoIdFromText} from './lib.mjs';

const targetLufs = -16;

function recordingKeys(value) {
  if (typeof value !== 'string') return [];
  const clean = value.trim();
  if (!clean) return [];
  const filename = clean.split(/[\\/]/).at(-1);
  const embedded = filename.match(/\[([A-Za-z0-9_-]{11})\]|(?:^|\s-\s|__)([A-Za-z0-9_-]{11})\.[a-z0-9]+$/i);
  const videoId = videoIdFromText(clean) || embedded?.[1] || embedded?.[2];
  return [...new Set([clean, filename, videoId].filter(Boolean))];
}

function numeric(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string' || !value.trim()) return NaN;
  return Number(value);
}

function correction(record) {
  if (record && typeof record === 'object') {
    const gain = numeric(record.gainDb ?? record.gain_db ?? record.adjustment_db);
    if (Number.isFinite(gain)) return gain;
  }
  const input = numeric(record && typeof record === 'object'
    ? record.lufs ?? record.integrated_lufs ?? record.integratedLufs ?? record.input_i
    : record);
  return input >= -70 && input <= 0 ? targetLufs - input : NaN;
}

export function parseLoudness(data) {
  if (!data || typeof data !== 'object') throw new Error('Format JSON non reconnu.');
  const analysed = data.schemaVersion === 1 && Object.hasOwn(data, 'recordings');
  const source = analysed ? data.recordings : (data.tracks ?? data.files ?? data.entries ?? data);
  if (!source || typeof source !== 'object') throw new Error('Liste des enregistrements introuvable.');
  const entries = Array.isArray(source) ? source.map(record => ['', record]) : Object.entries(source);
  const records = [];
  for (const [key, record] of entries) {
    const db = analysed ? numeric(record?.track?.gainDB) : correction(record);
    if (!Number.isFinite(db)) continue;
    const keys = [...new Set([key, record?.id, record?.videoId, record?.youtube, record?.youtubeId, record?.youtube_id,
      record?.filename, record?.file, record?.path, record?.audioUrl].flatMap(recordingKeys))];
    if (keys.length) records.push({keys, db});
  }
  if (!records.length) throw new Error('Aucune mesure de volume reconnue.');
  return records;
}

export function volumeForTrack(track, records) {
  if (!records.length) return 1;
  const keys = new Set([track.id, track.videoId, track.audioUrl].flatMap(recordingKeys));
  const record = records.find(entry => entry.keys.some(key => keys.has(key)));
  if (!record) return 1;
  // Use a shared ceiling so quieter measured tracks can stay at full volume without clipping.
  const ceiling = records.reduce((max, entry) => Math.max(max, entry.db), 0);
  return 10 ** (Math.max(-60, record.db - ceiling) / 20);
}
