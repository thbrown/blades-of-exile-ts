/**
 * Registers the service worker that makes the published site a PWA — one a
 * player can install, and that plays offline once it has loaded
 * (src/platform/serviceWorker.js; vite.config.ts writes it into the build).
 *
 * Production builds only: under the dev server there is no `sw.js`, and a
 * worker caching the game would only get between an edit and the reload.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
    .catch((err: unknown) => console.warn('Service worker not registered; the game will not work offline.', err));
}
