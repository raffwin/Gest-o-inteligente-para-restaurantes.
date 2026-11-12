/* Operatto PWA shell cache. API/auth responses and user data are never cached. */
const CACHE_PREFIX = "operatto-shell-";
const CACHE_VERSION = "v1";
const SHELL_CACHE = CACHE_PREFIX + CACHE_VERSION;
const APP_ROOT = new URL("./", self.registration.scope);
const SHELL_FILES = [
  APP_ROOT.href,
  new URL("index.html", APP_ROOT).href,
  new URL("manifest.json", APP_ROOT).href,
  new URL("icons/operatto.svg", APP_ROOT).href,
  new URL("icons/operatto-192.png", APP_ROOT).href,
  new URL("icons/operatto-512.png", APP_ROOT).href,
  new URL("icons/apple-touch-icon.png", APP_ROOT).href
];
const STATIC_CDN_HOSTS = new Set([
  "cdn.jsdelivr.net",
  "cdnjs.cloudflare.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com"
]);

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(SHELL_FILES.map(async url => {
      try {
        const response = await fetch(url, { cache: "reload" });
        if (response.ok) await cache.put(url, response);
      } catch (_) {
        // Keep installation resilient if one optional asset is unavailable.
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== SHELL_CACHE)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Never intercept Supabase, authentication, database, or other API traffic.
  if (/\.supabase\.co$/i.test(url.hostname) || url.pathname.includes("/auth/") || url.pathname.includes("/rest/v1/") || url.pathname.includes("/functions/v1/")) return;
  const hasAuthMaterial = ["code", "access_token", "refresh_token", "token", "authorization", "apikey"]
    .some(key => url.searchParams.has(key));

  const isAppOrigin = url.origin === self.location.origin;
  const isStaticCdn = STATIC_CDN_HOSTS.has(url.hostname) &&
    ["script", "style", "font"].includes(request.destination);
  if (!isAppOrigin && !isStaticCdn) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      try {
        const response = await fetch(request);
        if (response.ok && url.origin === self.location.origin && !hasAuthMaterial) await cache.put(request, response.clone());
        return response;
      } catch (_) {
        if (hasAuthMaterial) return Response.error();
        return (await cache.match(request)) || (await cache.match(APP_ROOT.href)) ||
          (await cache.match(new URL("index.html", APP_ROOT).href)) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Network-first refreshes published shell/CDN assets while online and
    // falls back to the previously saved static response when offline.
    try {
      const response = await fetch(request);
      if (response.ok || response.type === "opaque") await cache.put(request, response.clone());
      return response;
    } catch (_) {
      return (await cache.match(request)) || Response.error();
    }
  })());
});
