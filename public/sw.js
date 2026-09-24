/*
 * Reserve-A-Room service worker (ADR-12). Deliberately small:
 *
 *  - Pre-caches the offline page (plus the hashed CSS/JS/fonts it needs) and the brand
 *    images, and serves /offline when a page navigation fails.
 *  - Caches immutable, content-hashed build assets (/_next/static) after first use.
 *  - NEVER caches pages, server actions, RSC payloads, API or Supabase responses, and
 *    never touches /admin/auth or /reservation (whose links carry private tokens).
 *    Availability and reservations are always live, and nothing can be submitted offline.
 *
 * The page registers /sw.js?v=<build id>, so every deployment installs a fresh worker
 * that re-caches the offline page and drops the previous version's caches.
 */

const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const SHELL_CACHE = `rar-shell-${VERSION}`;
const STATIC_CACHE = `rar-static-${VERSION}`;
const OFFLINE_URL = "/offline";
const PRECACHE = [
  "/branding/stonehill-mark.png",
  "/branding/stonehill-logo.png",
  "/branding/stonehill-logo-dark.png",
  "/icons/icon-192.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(PRECACHE);
      // Cache the offline page and every hashed asset it references, so it renders
      // fully styled with no network.
      const response = await fetch(OFFLINE_URL, { cache: "reload", credentials: "omit" });
      if (!response.ok) throw new Error(`offline page returned ${response.status}`);
      const html = await response.clone().text();
      await cache.put(OFFLINE_URL, response);
      const assets = new Set(html.match(/\/_next\/static\/[^"'\s)]+/g) || []);
      const staticCache = await caches.open(STATIC_CACHE);
      await staticCache.addAll([...assets]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, STATIC_CACHE]);
      for (const key of await caches.keys()) {
        if (key.startsWith("rar-") && !keep.has(key)) await caches.delete(key);
      }
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      await self.clients.claim();
    })(),
  );
});

function isBypassed(url) {
  return (
    url.pathname.startsWith("/reservation/") ||
    url.pathname.startsWith("/admin/auth/") ||
    url.pathname.startsWith("/api/")
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isBypassed(url)) return;

  // Page navigations: always the network; the offline page only when that fails.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const preloaded = await event.preloadResponse;
          return preloaded || (await fetch(request));
        } catch {
          const offline = await caches.match(OFFLINE_URL, { cacheName: SHELL_CACHE });
          return offline || Response.error();
        }
      })(),
    );
    return;
  }

  // Content-hashed build output never changes: cache first.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(STATIC_CACHE);
          await cache.put(request, response.clone());
        }
        return response;
      })(),
    );
    return;
  }

  // Brand images and icons: network first, cached copy when offline.
  if (url.pathname.startsWith("/branding/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(fetch(request).catch(async () => (await caches.match(request)) || Response.error()));
  }
  // Everything else (RSC payloads, images, data) goes straight to the network.
});
