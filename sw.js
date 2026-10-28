const CACHE_NAME = 'chant-keeper-v14';
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
    fetch(freshRequest(event.request)).then(res => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
      }
      return res;
    }).catch(() => caches.match(event.request))
  );
});

// 自己網站的檔案每次都跟伺服器確認一次（沒變就只回「沒變」，很省流量），
// 避免手機瀏覽器拿自己暫存的舊檔；外部的 Firebase、字型照舊用暫存
function freshRequest(req) {
  if (new URL(req.url).origin !== self.location.origin) return req;
  try { return new Request(req, { cache: 'no-cache' }); } catch (e) { return req; }
}
