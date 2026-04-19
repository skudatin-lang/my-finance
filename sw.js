// Service Worker — my-finance PWA
// ВАЖНО: меняй CACHE при каждом деплое новых файлов → v5 → v6 ...
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

// Эти домены никогда не кэшируем
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
      .then(c => {
        // Кэшируем каждый файл отдельно — если один не загрузится, остальные сохранятся
        return Promise.allSettled(
          ASSETS.map(url =>
            c.add(new Request(url, { cache: 'reload' }))
              .catch(err => console.warn('[SW] Failed to cache:', url, err))
          )
        );
      })
  );
  // Активируем новый SW немедленно
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  console.log('[SW] Activating version:', CACHE);
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE).map(k => {
          console.log('[SW] Deleting old cache:', k);
          return caches.delete(k);
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Только GET
  if (e.request.method !== 'GET') return;

  // API — только сеть, не кэшируем
  if (NETWORK_ONLY.some(domain => url.includes(domain))) return;

  // Навигационные запросы (открытие из иконки, переход по URL)
  // ВСЕГДА отдаём index.html — это ключевое для работы PWA на iOS
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch('./index.html', { cache: 'no-cache' })
        .then(response => {
          // Обновляем кэш
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put('./index.html', clone));
          return response;
        })
        .catch(() =>
          // Нет сети — берём из кэша
          caches.match('./index.html')
        )
    );
    return;
  }

  // Остальные ресурсы: сначала кэш, при промахе — сеть
  // Для статики (JS, CSS, картинки) это быстрее
  e.respondWith(
    caches.match(e.request)
      .then(cached => {
        if (cached) {
          // Фоновое обновление кэша (stale-while-revalidate)
          fetch(e.request)
            .then(fresh => {
              if (fresh && fresh.status === 200) {
                caches.open(CACHE).then(c => c.put(e.request, fresh));
              }
            })
            .catch(() => {});
          return cached;
        }
        // Не в кэше — идём в сеть
        return fetch(e.request)
          .then(response => {
            if (response && response.status === 200) {
              const clone = response.clone();
              caches.open(CACHE).then(c => c.put(e.request, clone));
            }
            return response;
          });
      })
  );
});
