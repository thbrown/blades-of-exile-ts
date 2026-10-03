/**
 * The service worker that lets the published game run offline (a PWA).
 *
 * Plain JS, not TypeScript: vite.config.ts (`serviceWorker()`) copies it to
 * `<outDir>/sw.js` after a build, replacing the two placeholders below with
 * the build's version and its list of files. The dev server never registers
 * it (main.ts), so `npm run dev` and the verify scripts are unaffected.
 *
 * - **Precached**: the game, its graphics/sounds/fonts/dialogs, the bundled
 *   scenarios, the Exile III pages and the library's catalog — everything a
 *   first visit needs to play again without a network. One cache per build;
 *   a new build's worker fills its own and deletes the old ones.
 * - **Cached when first fetched**: the library's previews and the Exile III
 *   installer. The library's scenario zips are not: an installed scenario is
 *   already kept whole in IndexedDB, so a second copy here would only cost
 *   the player space.
 * - **Pages are network-first**, so an online player always gets the latest
 *   build; offline, any page under the site falls back to its cached copy
 *   (the query string — `?scenario=`, `?seed=` — is ignored for that).
 */

const VERSION = '__SW_VERSION__';
/** Paths relative to the worker's scope (the site's base URL). */
const PRECACHE = /** @type {string[]} */ (__SW_PRECACHE__);

const PRECACHE_NAME = `boe-precache-${VERSION}`;
/** Kept across builds: what's in it is named by what it is, not by a build. */
const RUNTIME_NAME = 'boe-runtime-1';

const scope = new URL(self.registration.scope);
const toUrl = (path) => new URL(path, scope).href;

/** Same-origin paths fetched on demand and then kept. */
const RUNTIME_CACHED = [/^library\/previews\//, /^exile3\/EXL3INST\.EXE$/];
/** Fetched fresh when online, served from the cache when not. */
const NETWORK_FIRST = [/^library\/catalog\.json$/];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(PRECACHE_NAME);
    // `cache: 'reload'` past the HTTP cache, so a file the browser still
    // holds from an older build isn't stored under this build's name.
    await cache.addAll(PRECACHE.map((p) => new Request(toUrl(p), { cache: 'reload' })));
    // Take over at once rather than when every tab has closed: otherwise a
    // player who only ever reloads one tab would never see an update. A tab
    // still running the old build loses nothing it hasn't already loaded,
    // and anything it fetches later falls through to the network, as it
    // would with no worker at all.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('boe-precache-') && name !== PRECACHE_NAME) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const path = url.pathname.slice(scope.pathname.length);

  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, PRECACHE_NAME, { ignoreSearch: true }));
  } else if (NETWORK_FIRST.some((re) => re.test(path))) {
    event.respondWith(networkFirst(req, PRECACHE_NAME, {}));
  } else if (RUNTIME_CACHED.some((re) => re.test(path))) {
    event.respondWith(cacheFirst(req, RUNTIME_NAME));
  } else {
    event.respondWith(precached(req));
  }
});

/**
 * The precached copy, else the network. `ignoreVary`: a module script's
 * request carries an `Origin` header the install's didn't, and a server that
 * answers `Vary: Origin` (Vite's does) would otherwise never match.
 */
async function precached(req) {
  const cache = await caches.open(PRECACHE_NAME);
  return (await cache.match(req, { ignoreVary: true })) ?? fetch(req);
}

/** The cached copy, else the network — keeping what comes back. */
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreVary: true });
  if (hit) return hit;
  const resp = await fetch(req);
  if (resp.ok) await cache.put(req, resp.clone());
  return resp;
}

/**
 * The network, refreshing the cached copy; offline, the cached copy. A page
 * whose own path was never cached (`/blades-of-exile-ts/?scenario=x` is
 * cached as `index.html`) falls back to the game's page.
 */
async function networkFirst(req, cacheName, matchOptions) {
  const cache = await caches.open(cacheName);
  try {
    const resp = await fetch(req);
    if (resp.ok && new URL(req.url).search === '') await cache.put(req, resp.clone());
    return resp;
  } catch (err) {
    const hit = (await cache.match(req, { ...matchOptions, ignoreVary: true }))
      ?? (req.mode === 'navigate' ? await cache.match(toUrl('index.html')) : undefined);
    if (hit) return hit;
    throw err;
  }
}
