const CACHE = 'my-finance-v2';
const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/core.js',
  '/reports.js',
  '/dds.js',
  '/calendar.js',
  '/settings.js',
  '/operations.js',
  '/dashboard.js',
  '/analytics.js',
  '/goals.js',
  '/recurring.js',
  '/health.js',
  '/loans.js',
  '/templates.js',
  '/portfolio.js',
  '/import-csv.js',
  '/assets.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
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
  // Firebase requests — always network
  if (e.request.url.includes('firebase') || e.request.url.includes('google')) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const clone = response.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return response;
      });
    })
  );
});
