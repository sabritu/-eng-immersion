// Service Worker：離線快取策略
// v3.2 修正：index.html／sw.js 這種常常會改版的檔案改成「網路優先」，
// 避免瀏覽器內建的 SW 更新節流機制（最長可能一天才檢查一次）讓使用者
// 一直看到舊版；圖示、辭典這種幾乎不會變的檔案維持「快取優先」節省流量。
const CACHE_NAME = 'eng-immersion-v10';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './ecdict.json'
];

// 網路優先的檔案（常改版，離線時才退回快取）
// v9 修正：這裡原本寫死絕對路徑（如 '/index.html'），只在網站部署於網域
// 根目錄時才會match。這個 App 部署在 GitHub Pages 的子路徑
// （/-eng-immersion/index.html），路徑永遠對不上，導致「網路優先」形同虛設，
// 使用者不管怎麼重整都還是看到舊版，只能手動清瀏覽器資料才治得好。
// 改用 endsWith 判斷檔名，不管部署在哪一層路徑下都能正確比對。
const NETWORK_FIRST_SUFFIXES = ['/index.html', '/sw.js', '/manifest.json'];

function isNetworkFirstPath(pathname) {
  if (NETWORK_FIRST_SUFFIXES.some((suffix) => pathname.endsWith(suffix))) return true;
  // 根路徑（例如 /-eng-immersion/ 本身，不含檔名）也要走網路優先
  return pathname === new URL(self.registration.scope).pathname;
}

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

// Web Push：訂閱時用 userVisibleOnly: true，代表每次收到 push
// 都必須顯示通知，不能靜默處理（瀏覽器規範強制要求）。
// 提醒內容固定不變，不需要解析 payload。
self.addEventListener('push', (event) => {
  event.waitUntil(
    self.registration.showNotification('記憶即將遺忘', {
      body: '有字卡到期了，打開 App 複習一下',
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: 'due-reminder'
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('./index.html'));
});
