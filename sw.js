// Service Worker：cache-first 離線快取策略
const CACHE_NAME = 'eng-immersion-v3';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './dict/ecdict.json'
];

// 安裝階段：預先快取核心檔案
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// 啟用階段：清除舊版本快取
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// 攔截請求：cache-first，命中快取直接回傳，否則走網路並補進快取
// 外部 API（字典查詢、YouTube）不快取，一律走網路，失敗就讓呼叫端自行處理
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 只快取同網域的 GET 請求，避免快取到字典 API / YouTube 等外部資源
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});
