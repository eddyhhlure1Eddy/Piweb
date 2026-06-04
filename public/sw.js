var CACHE_NAME = 'piweb-v1';
var PRECACHE = ['/', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/manifest.json'];

self.addEventListener('install', function(e) {
  e.waitUntil(caches.open(CACHE_NAME).then(function(c) { return c.addAll(PRECACHE); }));
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(names.filter(function(n) { return n !== CACHE_NAME; }).map(function(n) { return caches.delete(n); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  var url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) return;
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).catch(function() { return caches.match(e.request); })
  );
});
