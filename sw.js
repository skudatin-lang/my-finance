const CACHE = 'myfinance-v3';
const ASSETS = [
  '/', '/index.html',
  '/styles.css', '/core.js', '/dashboard.js', '/reports.js',
  '/dds.js', '/calendar.js', '/analytics.js', '/goals.js',
  '/recurring.js', '/health.js', '/loans.js', '/templates.js',
  '/portfolio.js', '/import-csv.js', '/assets.js', '/shopping.js',
  '/settings.js', '/operations.js', '/manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Network first for Firebase, cache first for static assets
  if (e.request.url.includes('firebase') || e.request.url.includes('google')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
