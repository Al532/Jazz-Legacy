const audioLimit = 12 * 1024 * 1024;

async function fetchAudio(url, signal) {
  const response = await fetch(url, {signal, priority: 'low'});
  const type = response.headers.get('Content-Type')?.split(';')[0];
  if (response.status !== 200 || !type?.startsWith('audio/') ||
      Number(response.headers.get('Content-Length')) > audioLimit) {
    await response.body?.cancel();
    return;
  }
  const reader = response.body?.getReader();
  if (!reader) return;
  const chunks = [];
  let size = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) return size ? new Blob(chunks, {type}) : undefined;
    size += value.byteLength;
    if (size > audioLimit) {
      await reader.cancel();
      return;
    }
    chunks.push(value);
  }
}

export function audioCache() {
  const entries = new Map();
  let wanted = [];
  let loading;

  async function prepareNext() {
    if (loading) return;
    const url = wanted.find(url => !(entries.get(url)?.expires > Date.now()));
    if (!url) return;
    const request = loading = {url, controller: new AbortController()};
    const timeout = setTimeout(() => request.controller.abort(), 90000);
    let file;
    try { file = await fetchAudio(url, request.controller.signal); }
    catch { /* Playback can still stream this recording on demand. */ }
    finally { clearTimeout(timeout); }
    if (loading !== request) return;
    loading = undefined;
    entries.delete(url);
    entries.set(url, {file, expires: Date.now() + (file ? 1800000 : 120000)});
    if (entries.size > 6) entries.delete(entries.keys().next().value);
    prepareNext();
  }

  function prepare(urls) {
    wanted = urls;
    if (loading && !wanted.includes(loading.url)) {
      loading.controller.abort();
      loading = undefined;
    }
    prepareNext();
  }

  return {
    prepare,
    get(url) {
      const entry = entries.get(url);
      return entry?.expires > Date.now() ? entry.file : undefined;
    },
    remove: url => entries.delete(url),
    clear() { prepare([]); entries.clear(); },
  };
}

export function coverCache() {
  const entries = new Map();

  function load(url, priority) {
    const cached = entries.get(url);
    if (cached?.expires > Date.now()) return cached.ready;
    const image = new Image();
    const entry = {image, expires: Infinity};
    entry.ready = new Promise(resolve => {
      const complete = loaded => {
        clearTimeout(timeout);
        image.onload = image.onerror = null;
        entry.expires = Date.now() + (loaded ? 1800000 : 30000);
        resolve(loaded);
      };
      const timeout = setTimeout(() => complete(false), 10000);
      image.onload = () => complete(true);
      image.onerror = () => complete(false);
      image.fetchPriority = priority;
      image.src = url;
    });
    entries.delete(url);
    entries.set(url, entry);
    if (entries.size > 32) entries.delete(entries.keys().next().value);
    return entry.ready;
  }

  return async (sources, priority = 'low') => {
    for (const url of sources) if (await load(url, priority)) return url;
  };
}
