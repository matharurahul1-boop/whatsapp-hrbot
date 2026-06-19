const CACHE   = 'hrbot-v2';
const PRECACHE = ['/offline', '/icon-192.svg', '/icon-512.svg', '/manifest.webmanifest'];

// ── Install: precache offline page + icons ────────────────────────────────
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE).catch(() => {}))
  );
});

// ── Activate: purge old caches ────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // Navigation (page loads) — network first, offline fallback
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() =>
        caches.match('/offline').then(r => r || Response.error())
      )
    );
    return;
  }

  // Static assets — stale-while-revalidate
  const isStatic =
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.endsWith('.svg')   ||
    url.pathname.endsWith('.png')   ||
    url.pathname.endsWith('.ico')   ||
    url.pathname.endsWith('.woff2') ||
    url.pathname === '/manifest.webmanifest';

  if (isStatic) {
    e.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match(e.request).then(hit => {
          const fresh = fetch(e.request).then(res => {
            if (res.ok) cache.put(e.request, res.clone());
            return res;
          }).catch(() => hit || Response.error());
          return hit || fresh;
        })
      )
    );
  }
});
