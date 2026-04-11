// Service Worker for PWA (offline caching + icon support)
const CACHE = 'my-finance-v2';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './core.js',
  './dashboard.js',
  './analytics.js',
  './assets.js',
  './calendar.js',
  './dds.js',
  './goals.js',
  './health.js',
  './import-csv.js',
  './loans.js',
  './operations.js',
  './portfolio.js',
  './recurring.js',
  './reports.js',
  './settings.js',
  './shopping.js',
  './templates.js',
  './voice.js',
  './family.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, {cache:'reload'}))))
      .catch(err => console.warn('SW cache failed:', err))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Network first for Firebase, STT, GPT
  if(e.request.url.includes('firebase') || e.request.url.includes('yandex') || 
     e.request.url.includes('workers.dev') || e.request.method !== 'GET'){
    return;
  }
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
