const CACHE = 'jazz-legacy-shell-v27';
const CATALOGUE = '/catalogue-data.json';
const FILES = [
  '/', '/styles.css', '/app.js', '/lib.mjs', '/listening.mjs', '/loudness.mjs',
  '/library-ui.mjs', '/account.mjs', '/sync.mjs', '/supabase.js', '/supabase-config.mjs',
  '/offline.mjs', '/manifest.webmanifest',
  '/icon.png', '/icon-192.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key =>
    key !== CACHE && (key.startsWith('jazz-legacy-shell-') || key.startsWith('heads-shell-')),
  ).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method === 'GET' && url.origin === location.origin && url.pathname === CATALOGUE) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(event.request, {cache: 'no-store'});
        if (response.ok) {
          try { await cache.put(CATALOGUE, response.clone()); } catch { /* offline storage is optional */ }
          return response;
        }
        return await cache.match(CATALOGUE) || response;
      } catch { return await cache.match(CATALOGUE) || Response.error(); }
    })());
    return;
  }
  if (event.request.method !== 'GET' || url.origin !== location.origin || !FILES.includes(url.pathname)) return;
  event.respondWith(fetch(event.request).catch(async () => {
    const cache = await caches.open(CACHE);
    return await cache.match(url.pathname) || Response.error();
  }));
});
