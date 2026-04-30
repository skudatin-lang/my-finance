// sw.js — Service Worker (исправлен: не перехватывает terms.html и privacy.html)
const CACHE = 'my-finance-v5';

const ASSETS = [
  './index.html',
  './styles.css',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './core.js',
  './operations.js',
  './recurring.js',
  './dashboard.js',
  './reports.js',
  './dds.js',
  './calendar.js',
  './health.js',
  './shopping.js',
  './loans.js',
  './settings.js',
  './voice.js',
  './tour.js',
  './eventBus.js',
  './moduleRegistry.js',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
];

const NETWORK_ONLY = [
  'firebase',
  'googleapis.com',
  'gstatic.com',
  'deepseek.com',
  'yandex',
  'workers.dev',
  'anthropic.com',
];

self.addEventListener('install', e => {
  console.log('[SW] Installing version:', CACHE);
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(
        ASSETS.map(url => c.add(new Request(url, { cache: 'reload' })).catch(err => console.warn('[SW] Failed to cache:', url, err)))
      ))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  console.log('[SW] Activating version:', CACHE);
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  if (e.request.method !== 'GET') return;
  if (NETWORK_ONLY.some(domain => url.includes(domain))) return;

  // Не перехватываем запросы к terms.html и privacy.html (открываются в новой вкладке)
  if (url.endsWith('terms.html') || url.endsWith('privacy.html')) {
    return;
  }

  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch('./index.html', { cache: 'no-cache' })
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put('./index.html', clone));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) {
        fetch(e.request).then(fresh => { if (fresh && fresh.status === 200) caches.open(CACHE).then(c => c.put(e.request, fresh)); }).catch(() => {});
        return cached;
      }
      return fetch(e.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return response;
      });
    })
  );
});