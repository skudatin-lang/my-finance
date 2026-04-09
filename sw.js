const CACHE = 'myfinance-v5';
const BASE = self.location.pathname.replace('sw.js','');

// Files to cache
const ASSETS = [
  BASE,
  BASE+'index.html',
  BASE+'styles.css',
  BASE+'core.js',
  BASE+'dashboard.js',
  BASE+'reports.js',
  BASE+'dds.js',
  BASE+'calendar.js',
  BASE+'analytics.js',
  BASE+'goals.js',
  BASE+'recurring.js',
  BASE+'health.js',
  BASE+'loans.js',
  BASE+'templates.js',
  BASE+'portfolio.js',
  BASE+'import-csv.js',
  BASE+'assets.js',
  BASE+'shopping.js',
  BASE+'settings.js',
  BASE+'operations.js',
  BASE+'ai-input.js',
  BASE+'manifest.json',
  BASE+'icon-192.png',
  BASE+'icon-512.png',
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(cache =>
      Promise.allSettled(ASSETS.map(url =>
        cache.add(new Request(url, {cache:'reload'})).catch(()=>{})
      ))
    )
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  // Skip Firebase/Google/external requests
  if(url.includes('firebaseio.com')||url.includes('googleapis.com')||
     url.includes('google.com')||url.includes('gstatic.com')||
     url.includes('yandex')||url.includes('workers.dev')){
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => {
      if(cached) return cached;
      return fetch(e.request).then(res => {
        if(res && res.ok){
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone)).catch(()=>{});
        }
        return res;
      }).catch(() => caches.match(BASE+'index.html'));
    })
  );
});
