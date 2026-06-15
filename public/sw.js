// バラ推し Service Worker
// - Web Push 通知の受信・クリック処理
// - オフライン時のフォールバック画面（PWA対応）

const OFFLINE_URL = '/offline.html';
const CACHE = 'baraoshi-v2';
const API_CACHE = 'baraoshi-api-v2';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add(OFFLINE_URL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE && k !== API_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // ページ遷移：オフラインならフォールバック画面
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  // /api/recommend：network-first → オフライン時は直近キャッシュを返す
  if (url.origin === self.location.origin && url.pathname === '/api/recommend') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(API_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match(API_CACHE)))
    );
  }
});

// Push 受信
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'バラ推し', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'バラ推し';
  const options = {
    body: data.body || '新しい番組が追加されました🎬',
    icon: '/icon.svg',
    badge: '/icon.svg',
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// 通知クリック → アプリを開く
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
