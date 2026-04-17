// Service Worker — my-finance PWA
// ВАЖНО: при каждом деплое новых файлов меняйте версию CACHE (v3 → v4 → ...)
// Это гарантирует что браузер загрузит свежие файлы, а не старый кэш
const CACHE = 'my-finance-v3';

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
  // ── Внешние зависимости ──
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
];

// Домены которые НИКОГДА не кэшируем — всегда сеть
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
  // Активируем новый SW немедленно, не ждём закрытия вкладок
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE)
          .map(k => {
            console.log('SW: removing old cache', k);
            return caches.delete(k);
          })
      )
    )
  );
  // Берём контроль над всеми вкладками немедленно
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Только GET запросы кэшируем
  if (e.request.method !== 'GET') return;

  // Сетевые запросы к API — никогда не кэшируем
  if (NETWORK_ONLY.some(domain => url.includes(domain))) return;

  // Стратегия: сеть первая, кэш как fallback
  // Это гарантирует свежие файлы при наличии сети
  // и работу офлайн при её отсутствии
  e.respondWith(
    fetch(e.request)
      .then(response => {
        // Обновляем кэш свежим ответом
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});
