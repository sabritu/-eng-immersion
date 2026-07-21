// Service Worker：離線快取策略
// v3.2 修正：index.html／sw.js 這種常常會改版的檔案改成「網路優先」，
// 避免瀏覽器內建的 SW 更新節流機制（最長可能一天才檢查一次）讓使用者
// 一直看到舊版；圖示、辭典這種幾乎不會變的檔案維持「快取優先」節省流量。
const CACHE_NAME = 'eng-immersion-v8';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './ecdict.json'
];

// 網路優先的檔案（常改版，離線時才退回快取）
const NETWORK_FIRST_PATHS = ['/', '/index.html', '/sw.js', '/manifest.json'];

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

function isNetworkFirstPath(pathname) {
  return NETWORK_FIRST_PATHS.includes(pathname);
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 只處理同網域的 GET 請求，避免快取到字典 API / YouTube 等外部資源
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  if (isNetworkFirstPath(url.pathname)) {
    // 網路優先：先試著抓最新版，失敗（離線）才退回快取
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // 其餘靜態資源維持 cache-first，節省流量
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
