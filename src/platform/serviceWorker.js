/**
 * The service worker that lets the published game run offline (a PWA).
 *
 * Plain JS, not TypeScript: vite.config.ts (`serviceWorker()`) copies it to
 * `<outDir>/sw.js` after a build, replacing the placeholders below with the
 * build's version and its lists of files. The dev server never registers
 * it (main.ts), so `npm run dev` and the verify scripts are unaffected.
 *
 * - **Precached**: the game, its graphics/sounds/fonts/dialogs, the Exile III
 *   pages, the library's catalog, and of each bundled scenario only what the
 *   startup screen shows (`scenario.xml` for its card, `preview.png`). One
 *   cache per build; a new build's worker fills its own and deletes the old.
 * - **A bundled scenario is cached once it's played**: the first time the
 *   game loads any other file of `scenarios/<id>/`, the worker fetches the
 *   whole directory into a cache of its own, `boe-scenario-<id>-<hash>`, the
 *   hash being of that scenario's files. A build that leaves a scenario alone
 *   keeps its cache as it is; one that changes it refreshes it the next time
 *   it's played online, and until then — or offline — the old copy serves.
 *   Exile III isn't among them: the browser converts it from the installer
 *   and keeps it in IndexedDB (src/platform/exile3.ts).
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
/**
 * Each bundled scenario's files not in `PRECACHE`, relative to its directory,
 * and a hash of their contents.
 */
const SCENARIOS = /** @type {Record<string, {hash: string, files: string[]}>} */ (__SW_SCENARIOS__);

const PRECACHE_NAME = `boe-precache-${VERSION}`;
/** Kept across builds: what's in it is named by what it is, not by a build. */
const RUNTIME_NAME = 'boe-runtime-1';

const scope = new URL(self.registration.scope);
const toUrl = (path) => new URL(path, scope).href;

/** Same-origin paths fetched on demand and then kept. */
const RUNTIME_CACHED = [/^library\/previews\//, /^exile3\/EXL3INST\.EXE$/];
/** Fetched fresh when online, served from the cache when not. */
const NETWORK_FIRST = [/^library\/catalog\.json$/];
const SCENARIO_FILE = /^scenarios\/([^/]+)\/(.+)$/;
const SCENARIO_CACHE = 'boe-scenario-';
const scenarioCacheName = (id) => `${SCENARIO_CACHE}${id}-${SCENARIOS[id]?.hash}`;
/** The scenario a `boe-scenario-<id>-<hash>` cache holds. */
const scenarioOfCache = (name) => name.slice(SCENARIO_CACHE.length, name.lastIndexOf('-'));

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
      // A scenario this build no longer ships. One it ships changed stays
      // until its new copy is whole (`fetchScenario`).
      if (name.startsWith(SCENARIO_CACHE) && !(scenarioOfCache(name) in SCENARIOS)) await caches.delete(name);
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
  } else if (SCENARIO_FILE.test(path) && !PRECACHE.includes(path)) {
    const [, id, file] = /** @type {RegExpExecArray} */ (SCENARIO_FILE.exec(path));
    event.respondWith(scenarioFile(event, req, id, file));
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

/**
 * The cached copy, else the network — keeping what comes back. Offline with
 * no copy (a library preview never shown online), a 404: the startup card
 * drops a preview that doesn't load, and a 404 is what this is to the page.
 */
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreVary: true });
  if (hit) return hit;
  let resp;
  try {
    resp = await fetch(req);
  } catch {
    return new Response(null, { status: 404, statusText: 'Not saved for offline play' });
  }
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

/**
 * A file of a bundled scenario. Played before (by this build's copy of it):
 * the cached copy. Otherwise the whole scenario is fetched into its cache —
 * this request among them, so nothing downloads twice — and the reply comes
 * from there. Offline with no copy of this build's, an older build's.
 */
async function scenarioFile(event, req, id, file) {
  const entry = SCENARIOS[id];
  if (!entry?.files.includes(file)) {
    // Not in this build (an optional file the loader probes for): offline,
    // the 404 the server would have given, not a network error.
    return fetch(req).catch(() => new Response(null, { status: 404, statusText: 'Not Found' }));
  }
  const cache = await caches.open(scenarioCacheName(id));
  const hit = await cache.match(toUrl(`scenarios/${id}/${file}`));
  if (hit) return hit;
  const downloads = fetchScenario(id);
  // The rest of the scenario keeps downloading after this reply has gone.
  event.waitUntil(Promise.allSettled(downloads.values()));
  try {
    await downloads.get(file);
    const fetched = await cache.match(toUrl(`scenarios/${id}/${file}`));
    if (fetched) return fetched;
  } catch { /* offline, or the file failed: an older copy, else the error */ }
  for (const name of await caches.keys()) {
    if (!name.startsWith(SCENARIO_CACHE) || scenarioOfCache(name) !== id) continue;
    const old = await (await caches.open(name)).match(toUrl(`scenarios/${id}/${file}`));
    if (old) return old;
  }
  // Offline and never played: a 503 the loader recognises by its header
  // (`ScenarioNotOfflineError`, src/fileio/source.ts), so it can say why.
  return fetch(req).catch(() => new Response(null, {
    status: 503, statusText: 'Not saved for offline play', headers: { 'X-BoE-Not-Offline': id },
  }));
}

/** Per scenario, its files' downloads in flight: one fetch each, shared. */
const inFlight = new Map();

/**
 * Starts fetching every file of scenario `id` not already in its cache, once
 * however many requests ask, and returns each file's download. When all of
 * them land, older builds' copies of the scenario are deleted; if any fails,
 * the next request tries the missing ones again.
 */
function fetchScenario(id) {
  const running = inFlight.get(id);
  if (running) return running;
  const name = scenarioCacheName(id);
  const cacheP = caches.open(name);
  /** @type {Map<string, Promise<void>>} */
  const downloads = new Map();
  for (const file of SCENARIOS[id].files) {
    const url = toUrl(`scenarios/${id}/${file}`);
    downloads.set(file, (async () => {
      const cache = await cacheP;
      if (await cache.match(url)) return;
      const resp = await fetch(new Request(url, { cache: 'reload' }));
      if (!resp.ok) throw new Error(`${resp.status} ${url}`);
      await cache.put(url, resp);
    })());
  }
  inFlight.set(id, downloads);
  void Promise.allSettled(downloads.values()).then(async (results) => {
    inFlight.delete(id);
    if (results.some((r) => r.status === 'rejected')) return;
    for (const other of await caches.keys()) {
      if (other !== name && other.startsWith(SCENARIO_CACHE) && scenarioOfCache(other) === id) {
        await caches.delete(other);
      }
    }
  });
  return downloads;
}
