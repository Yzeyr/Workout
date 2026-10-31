/*
 * Workout service worker.
 *
 * The gym often has weak signal, and iOS may kill the app when you switch to
 * music, so a relaunch mid-workout must open instantly and must not swap in a
 * half-loaded new version. So:
 * - A new version is cached completely or not at all.
 * - The page (index.html) is network-first, but never waits more than 2 seconds.
 * - All other app files come from the cached copy of the same version, so files
 *   from two versions never mix.
 * - Only good same-origin responses are cached.
 * - Only this app's own caches are cleaned up. The origin yzeyr.github.io is
 *   shared with other apps.
 *
 * VERSION and FILES are written by tools/version.mjs (run before every release).
 */
const VERSION = 'workout-72b40344';
const FILES = [
  './',
  './app.css',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './index.html',
  './manifest.webmanifest',
  './src/coach.js',
  './src/data/exercises.js',
  './src/data/muscles.js',
  './src/dom.js',
  './src/health.js',
  './src/home.js',
  './src/main.js',
  './src/muscles.js',
  './src/nav.js',
  './src/program.js',
  './src/state.js',
  './src/store.js',
  './src/timer.js',
  './src/util.js',
  './src/views/body.js',
  './src/views/coach.js',
  './src/views/history.js',
  './src/views/muscles.js',
  './src/views/settings.js',
  './src/views/train.js',
];
const WAIT_MS = 2000;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const responses = await Promise.all(FILES.map(async (url) => {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!good(res)) throw new Error('Could not fetch ' + url);
      return [url, res];
    }));
    const cache = await caches.open(VERSION);
    try {
      for (const [url, res] of responses) await cache.put(url, res);
    } catch (e) {
      await caches.delete(VERSION); // never use a half-filled copy
      throw e;
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('workout-') && name !== VERSION) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

function good(res) { return res && res.ok && res.type === 'basic'; }

async function networkFirst(req, key) {
  const cache = await caches.open(VERSION);
  const net = fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then(async (res) => {
    if (good(res)) await cache.put(key, res.clone());
    return res;
  });
  const deadline = new Promise((resolve) => setTimeout(resolve, WAIT_MS, null));
  try {
    const first = await Promise.race([net, deadline]);
    if (first && (first.ok || !(await cache.match(key)))) return first;
  } catch { /* offline: use the copy */ }
  const saved = await cache.match(key);
  if (saved) return saved;
  return net;
}

async function fromCopy(req, key) {
  const cache = await caches.open(VERSION);
  const saved = await cache.match(key);
  if (saved) return saved;
  const res = await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' });
  if (good(res)) await cache.put(key, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const scope = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scope.pathname)) return;
  // The old app lives in /v1/ with its own service worker and files.
  if (url.pathname.startsWith(scope.pathname + 'v1/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, './index.html').catch(() => caches.match('./')));
    return;
  }
  const key = '.' + url.pathname.slice(scope.pathname.length - 1);
  event.respondWith(fromCopy(req, key));
});
