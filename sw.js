/* Boxsmith service worker: makes the app installable and usable offline.
   Bump VERSION whenever you change app files so installed copies refresh. */
const VERSION='boxsmith-v46';
const CORE = [
  './', 'index.html', 'help.html', 'manifest.webmanifest',
  'three.min.js', 'designs.js', 'tools.js', 'box-types.js', 'boxsmith-api.js', 'box-layout.js',
  'mosaic-core.js', 'share.js', 'site.config.js', 'site.js', 'app.js', 'mosaic.js', 'boxsmith-engine.js', 'type-lab.js', 'BOX-TYPES.md', 'AI-TYPE-BUILDER.md', 'boxsmith-type.schema.json', 'types/closed-box.json', 'types/open-tray.json', 'types/cube-frame.json', 'types/box-with-shelf.json', 'remote-anim.js', 'remote.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png', 'icons/favicon-32.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

/* Cached copy first (instant, works offline), refreshed in the background.
   Covers the app files and the Google Fonts CSS/font files. */
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const fonts = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== location.origin && !fonts) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: true });
    const refresh = fetch(req).then(res => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    });
    if (hit) { refresh.catch(() => {}); return hit; }
    try { return await refresh; }
    catch (err) {
      if (req.mode === 'navigate') { const home = await cache.match('index.html'); if (home) return home; }
      throw err;
    }
  })());
});
