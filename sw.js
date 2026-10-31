// 離線快取：改了網頁檔案後，把版本號加一，手機才會抓到新版
const CACHE = 'bento-calendar-v4';
const FILES = ['./', 'index.html', 'app.js?v=4', 'firebase-config.js?v=4', 'manifest.json', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
// Firebase 程式庫也存起來，沒網路時才打得開
const SDK = 'https://www.gstatic.com/firebasejs/';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// 先用網路拿最新版，沒網路時用快取
self.addEventListener('fetch', (e) => {
  const url = e.request.url;
  if (e.request.method !== 'GET') return;
  const sdk = url.startsWith(SDK);
  if (!sdk && new URL(url).origin !== location.origin) return;
  e.respondWith(
    fetch(sdk ? e.request : url, sdk ? undefined : { cache: 'no-cache' }).then((r) => {
      const copy = r.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: !sdk }))
  );
});
