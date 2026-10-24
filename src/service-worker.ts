/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
// Offline support for the installed app (static-site build only; registered from +layout.svelte).
import { base, build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;
const SHELL_CACHE = `openplan3d-shell-${version}`;
const ASSET_CACHE = `openplan3d-assets-${version}`;
// Large catalog files are cached the first time they are used instead of at install.
const ON_DEMAND = /\/(models|textures)\//;
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
    for (const key of await caches.keys()) if (key !== SHELL_CACHE && key !== ASSET_CACHE) await caches.delete(key);
    await sw.clients.claim();
  })());
});

sw.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== sw.location.origin || !url.pathname.startsWith(base || '/')) return;
  // Update checks always ask the network.
  if (url.pathname.endsWith('/_app/version.json')) return;

  if (request.mode === 'navigate') {
    // Pages: network first, the saved app shell when offline (the app routes itself).
    event.respondWith(fetch(request).catch(async () => (await caches.match(`${base}/`, { cacheName: SHELL_CACHE })) ?? Response.error()));
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && ON_DEMAND.test(url.pathname)) {
      const copy = response.clone();
      event.waitUntil(caches.open(ASSET_CACHE).then(cache => cache.put(request, copy)));
    }
    return response;
  })());
});
