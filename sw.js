// Service Worker — my-finance PWA
// ВАЖНО: меняй CACHE при каждом деплое новых файлов
const CACHE = 'my-finance-v5';

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  // ── Ядро ──
  './core.js',
  './operations.js',
  './recurring.js',
  // ── Экраны ──
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
  // ── Внешние зависимости ──
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
];

// Домены — никогда не кэшируем (всегда сеть)
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
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
      .catch(err => console.warn('SW cache failed:', err))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Только GET
  if (e.request.method !== 'GET') return;

  // API и Firebase — только сеть
  if (NETWORK_ONLY.some(domain => url.includes(domain))) return;

  // Навигационные запросы (открытие приложения из иконки) —
  // всегда отдаём index.html из кэша если он есть
  // Это критично для iOS: без этого приложение не запускается офлайн
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(response => {
          // Обновляем кэш
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return response;
        })
        .catch(() => {
          // Нет сети — отдаём кэшированный index.html
          return caches.match('./index.html') || caches.match('./');
        })
    );
    return;
  }

  // Остальные ресурсы — сеть первая, кэш как fallback
  e.respondWith(
    fetch(e.request)
      .then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});
