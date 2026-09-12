const CACHE_VERSION = 'nexdash-v1';
const APP_SHELL = [
  '/index.html',
  '/manifest.json',
  '/css/style.css',
  '/js/app.js',
  '/js/db.js',
  '/js/overlay-engine.js',
  '/js/signature-engine.js',
  '/js/pdf-flatten.js',
  '/js/sync-engine.js',
  '/js/share.js',
  '/js/fonts.js',
  '/js/files.js',
  '/js/nexus.js',
  '/js/worker-config.js',
  '/js/ripple.js',
  '/js/canvas.js',
  '/templates/manifest.json',
  '/icons/icon-152.png',
  '/icons/icon-167.png',
  '/icons/icon-180.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Never intercept cross-origin API calls (Worker sync + NEXUS transcribe/summarize
  // live on intake.eliaslhx.com, a different origin from this app).
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((resp) => {
        if (event.request.method === 'GET' && resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
        }
        return resp;
      });
    })
  );
});
