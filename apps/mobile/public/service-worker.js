// Service worker for the installable web build.
// - Navigations: always fetch the freshest shell, bypassing the HTTP cache, so a
//   new deploy's index.html (and thus its new hashed JS bundle) is picked up
//   immediately. Falls back to the cached shell only when offline. Without the
//   cache bypass the browser can serve a stale index.html that points at a hashed
//   bundle the new deploy already deleted → 404 → blank screen.
// - Same-origin static assets (hashed JS/CSS/images): cache-first (immutable).
// - Everything cross-origin (the API lives on EXPO_PUBLIC_API_URL) is left to the
//   network untouched, so data is never served stale.
//
// The cache name and the precache list are stamped in per build by
// scripts/build-pwa.mjs. Two reasons that matters:
//
//  1. Storage stays bounded. The name used to be a constant, so every deploy
//     added its hashed bundles to the same cache and nothing ever removed the
//     old ones — a phone accumulated every bundle the club had shipped. A
//     per-build name means `activate` drops the previous deploy wholesale.
//  2. The app boots offline from the first visit. Precaching only the HTML shell
//     left the ~1.4 MB bundle to be fetched lazily, so a member who installed the
//     PWA and went offline before the JS was cached got a blank page.
//
// The two placeholders are replaced at build time; on the dev server this file
// is served but never registered, so they're harmless there.
const CACHE = "academy-__BUILD_ID__"
const PRECACHE = __PRECACHE__

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        // Not addAll: that's atomic, so one failed asset would leave the member
        // with no precache at all. Each miss just falls through to the network.
        Promise.all(
          PRECACHE.map((url) =>
            cache.add(new Request(url, { cache: "reload" })).catch(() => {}),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener("fetch", (event) => {
  const { request } = event
  if (request.method !== "GET") return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return // API / cross-origin → network

  if (request.mode === "navigate") {
    event.respondWith(
      // `cache: "reload"` skips the HTTP cache so we never boot a stale shell.
      fetch(request.url, { cache: "reload" })
        .then((response) => {
          const copy = response.clone()
          void caches.open(CACHE).then((cache) => cache.put("/index.html", copy))
          return response
        })
        .catch(() => caches.match("/index.html")),
    )
    return
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(request, copy))
          return response
        }),
    ),
  )
})
