// 오프라인 안내만 담당합니다. API 응답·메모·로그인 정보는 저장하지 않고, 페이지 이동이 실패할 때만 안내 화면을 보여 줍니다.
const CACHE = 'byteback-offline-v1';
const OFFLINE = '/offline.html';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add(OFFLINE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  // Only top-level page navigations; /api/* and every other request go straight to the network untouched.
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
});
