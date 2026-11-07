'use strict';
/* Service Worker: macht Manhunt installierbar (auch auf dem iPhone) und zeigt Push-Benachrichtigungen. */
const CACHE = 'manhunt-v1';
const SHELL = ['/', '/style.css', '/common.js', '/auth.js', '/index.js', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Netz zuerst (das Spiel braucht aktuelle Daten), Cache nur als Ersatz ohne Verbindung. API wird nie gecacht.
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok && SHELL.includes(u.pathname)) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request).then((m) => m || caches.match('/'))));
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Manhunt', {
    body: d.body || '', icon: '/icons/icon-192.png', badge: '/icons/favicon-32.png',
    tag: d.tag || undefined, renotify: !!d.tag, data: { url: d.url || '/' }, vibrate: d.urgent ? [300, 100, 300] : [150],
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    for (const c of cs) if (new URL(c.url).pathname === url && 'focus' in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});
