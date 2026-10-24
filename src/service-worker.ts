/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
// Offline support for the installed app (static-site build only; registered from +layout.svelte).
import { base, build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;
const SHELL_CACHE = `openplan3d-shell-${version}`;
const ASSET_CACHE = `openplan3d-assets-${version}`;
// Survives app updates: the fonts do not change with the app.
const FONT_CACHE = 'openplan3d-cad-fonts';
// Large catalog files and the DWG/DXF viewer (about 19 MB) are cached the first time they are used
// instead of at install.
const ON_DEMAND = /\/(models|textures|cad)\//;
const CAD_PAGES = `${base}/cad/`;
// Original CAD fonts served by the viewer library's CDN: kept once downloaded, for offline plots.
const CAD_FONTS = /^https:\/\/cdn\.jsdelivr\.net\/gh\/mlightcad\/cad-data@/;
// env.js holds the public settings SvelteKit loads at start-up; it is not part of `build`.
const shell = [`${base}/`, `${base}/_app/env.js`, ...build, ...files.filter(file => !ON_DEMAND.test(file) && !/\/test-[^/]*\.json$/.test(file))];

sw.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // One missing file must not leave the app without any offline copy.
    await Promise.all(shell.map(url => cache.add(url).catch(() => undefined)));
    await sw.skipWaiting();
  })());
});

sw.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== SHELL_CACHE && key !== ASSET_CACHE && key !== FONT_CACHE) await caches.delete(key);
    await sw.clients.claim();
  })());
});

sw.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (CAD_FONTS.test(request.url)) {
    event.respondWith(cacheFirst(request, event, FONT_CACHE));
    return;
  }
  if (url.origin !== sw.location.origin || !url.pathname.startsWith(base || '/')) return;
  // Update checks always ask the network.
  if (url.pathname.endsWith('/_app/version.json')) return;

  if (request.mode === 'navigate' && url.pathname.startsWith(CAD_PAGES)) {
    // The DWG/DXF viewer is a page of its own: keep the last copy for offline use.
    event.respondWith(fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(ASSET_CACHE).then(cache => cache.put(request, copy)));
      }
      return response;
    }).catch(async () => (await caches.match(request, { ignoreSearch: true, cacheName: ASSET_CACHE }))
      ?? (await caches.match(`${CAD_PAGES}index.html`, { cacheName: ASSET_CACHE }))
      ?? (await caches.match(CAD_PAGES, { cacheName: ASSET_CACHE }))
      ?? Response.error()));
    return;
  }

  if (request.mode === 'navigate') {
    // Pages: network first, the saved app shell when offline (the app routes itself).
    event.respondWith(fetch(request).catch(async () => (await caches.match(`${base}/`, { cacheName: SHELL_CACHE })) ?? Response.error()));
    return;
  }

  event.respondWith(ON_DEMAND.test(url.pathname) ? cacheFirst(request, event, ASSET_CACHE) : (async () => (await caches.match(request)) ?? fetch(request))());
});

async function cacheFirst(request: Request, event: FetchEvent, cacheName: string): Promise<Response> {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const copy = response.clone();
    event.waitUntil(caches.open(cacheName).then(cache => cache.put(request, copy)));
  }
  return response;
}
