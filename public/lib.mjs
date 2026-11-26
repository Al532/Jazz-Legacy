export function videoIdFromText(raw, {youtubeLink = false} = {}) {
  const text = String(raw || '').trim();
  const matches = text.match(/https?:\/\/[^\s<>"'()]+/g) || [];
  for (const candidate of matches.length ? matches : [text]) {
    try {
      const u = new URL(candidate.replace(/[.,;]+$/, ''));
      if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.port) continue;
      const hostname = u.hostname.toLowerCase().replace(/^www\./,'');
      let id = '';
      if (hostname === 'youtu.be') id = u.pathname.split('/')[1] || '';
      else if (['youtube.com','m.youtube.com','music.youtube.com','youtube-nocookie.com'].includes(hostname) ||
          (!youtubeLink && hostname === 'piped.video')) {
        if (!youtubeLink || u.pathname === '/watch') id = u.searchParams.get('v') || '';
        if (!id && /^\/(?:shorts|live|embed|v)\//.test(u.pathname)) id = u.pathname.split('/')[2] || '';
      }
      if (/^[\w-]{11}$/.test(id)) return id;
    } catch { /* continue */ }
  }
  return !youtubeLink && /^[\w-]{11}$/.test(text) ? text : null;
}
export function parseClock(raw) {
  const s = String(raw ?? '').trim().replace(',','.');
  if (!s) return null;
  const parts = s.split(':');
  if (parts.length > 3 || parts.some(p=>!/^\d+(?:\.\d+)?$/.test(p))) return NaN;
  let n = 0;
  for (const p of parts) n = n * 60 + Number(p);
  return n;
}
export function clock(seconds) {
  const n = Math.max(0, Math.floor(Number(seconds)||0));
  const h = Math.floor(n/3600), m = Math.floor((n%3600)/60), s = n%60;
  return (h ? `${h}:${String(m).padStart(2,'0')}` : String(m)) + ':' + String(s).padStart(2,'0');
}
export function mergeItems(a,b) {
  const map = new Map();
  for (const item of [...b,...a]) {
    const old = map.get(item.id);
    if (!old || item.updatedAt > old.updatedAt) map.set(item.id,item);
  }
  return [...map.values()];
}
export function visibleItems(items) { return items.filter(x=>!x.deleted).sort((a,b)=>a.order-b.order || a.updatedAt-b.updatedAt); }


export function keyLabels(item) {
  return [item.usualKey && 'Tonalité usuelle : ' + item.usualKey,
    item.versionKey && 'Version en ' + item.versionKey].filter(Boolean);
}
