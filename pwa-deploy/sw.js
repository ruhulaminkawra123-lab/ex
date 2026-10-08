/* ==========================================================
   আমাদের এক্সারসাইজ · Service Worker
   Strategy:
   - App shell (HTML, manifest, icons) is precached on install.
   - Page navigations: network-first (3s timeout) -> cached shell.
   - Same-origin static files: stale-while-revalidate.
   - Google Fonts CSS + font files: stale-while-revalidate (cross-origin ok).
   Bump CACHE_VERSION whenever you change any precached file.
   ========================================================== */
const CACHE_VERSION = 'v1';
const SHELL_CACHE   = 'exercise-shell-' + CACHE_VERSION;
const RUNTIME_CACHE = 'exercise-runtime-' + CACHE_VERSION;

const SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32.png'
];

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const NAV_TIMEOUT_MS = 3000;

/* ---------- install: precache the shell ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // "/" is critical: fail the install if it can't be cached.
    await cache.add(new Request('/', { cache: 'reload' }));
    // Everything else is best-effort so one missing file can't break install.
    await Promise.allSettled(
      SHELL_URLS.filter((u) => u !== '/').map((u) => cache.add(new Request(u, { cache: 'reload' })))
    );
    await self.skipWaiting();
  })());
});

/* ---------- activate: drop old caches, take control ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = [SHELL_CACHE, RUNTIME_CACHE];
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith('exercise-') && !keep.includes(k)).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

/* ---------- helpers ---------- */
function isCacheable(response) {
  // ok responses, plus opaque (status 0) cross-origin font responses
  return response && (response.ok || response.type === 'opaque');
}

async function staleWhileRevalidate(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => { if (isCacheable(res)) cache.put(request, res.clone()); return res; })
    .catch(() => null);
  return cached || (await network) || Response.error();
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await Promise.race([
      fetch(request),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), NAV_TIMEOUT_MS))
    ]);
    if (res && res.ok) cache.put('/', res.clone());
    return res;
  } catch (err) {
    const cached = (await cache.match('/')) || (await cache.match('/index.html'));
    if (cached) return cached;
    return new Response(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<body style="background:#0B0F17;color:#F9FAFB;font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;text-align:center">' +
      '<div><h2>অফলাইন</h2><p>ইন্টারনেট সংযোগ নেই। সংযোগ ফিরলে আবার চেষ্টা করুন।</p></div></body>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

/* ---------- fetch ---------- */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // HTML page loads
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // Google Fonts (CSS + woff2)
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  // Same-origin static files (icons, manifest, images, svg, css, js)
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
  }
  // Anything else: let the browser handle it normally.
});

/* ---------- optional: page can ask a waiting SW to activate ---------- */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
