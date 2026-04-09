const CACHE = 'myfinance-v4';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './core.js',
  './dashboard.js',
  './reports.js',
  './dds.js',
  './calendar.js',
  './analytics.js',
  './goals.js',
  './recurring.js',
  './health.js',
  './loans.js',
  './templates.js',
  './portfolio.js',
  './import-csv.js',
  './assets.js',
  './shopping.js',
  './settings.js',
  './operations.js',
  './ai-input.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS.map(url => new Request(url, {cache: 'reload'}))))
      .catch(err => console.log('Cache install error (non-fatal):', err))
      .then(() => self.skipWaiting())
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
  const url = e.request.url;
  // Always network for Firebase/Google APIs
  if (url.includes('firebase') || url.includes('googleapis') || url.includes('google.com')) {
    e.respondWith(
      fetch(e.request).catch(() => new Response('Network error', {status: 503}))
    );
    return;
  }
  // Cache first for static assets, network fallback
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.ok && res.type !== 'opaque') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone)).catch(()=>{});
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
