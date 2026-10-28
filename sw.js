const CACHE_NAME = 'chant-keeper-v13';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/db.js',
  './js/text-library.js',
  './js/firebase-config.js',
  './js/sync.js',
  './icons/icon.svg'
];
// 法本 PDF、法照圖片不列在這裡預先快取（清單會一直變動），
// 靠下面 fetch handler 的「看過就快取」機制自動離線可用

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 網路優先：能連線就一定拿最新版本，離線時才退回快取
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith('http')) return; // chrome-extension:// 等非 http(s) 請求不歸這裡管，Cache API 也不支援
  event.respondWith(
    fetch(event.request).then(res => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
      }
      return res;
    }).catch(() => caches.match(event.request))
  );
});
