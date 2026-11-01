// Service worker for the installable web build.
// - Navigations: always fetch the freshest shell, bypassing the HTTP cache, so a
//   new deploy's index.html (and thus its new hashed JS bundle) is picked up
//   immediately. Falls back to the cached shell only when offline. Without the
//   cache bypass the browser can serve a stale index.html that points at a hashed
//   bundle the new deploy already deleted → 404 → blank screen.
// - Same-origin static assets (hashed JS/CSS/images): cache-first (immutable).
// - Everything cross-origin (the API lives on EXPO_PUBLIC_API_URL) is left to the
//   network untouched, so data is never served stale.
// - Downloaded lessons live in their own caches ("cs-offline:<videoId>", see
//   src/features/offline/offline-media-cache.ts). They belong to the member,
//   not to a deploy: `activate` must never drop them, and their /__offline/
//   URLs are answered from those caches only — never the network, never the
//   build cache.
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
const OFFLINE_CACHE_PREFIX = "cs-offline:"
const OFFLINE_PATH_PREFIX = "/__offline/"

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
        Promise.all(
          keys
            .filter((k) => k !== CACHE && !k.startsWith(OFFLINE_CACHE_PREFIX))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener("fetch", (event) => {
  const { request } = event
  if (request.method !== "GET") return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return // API / cross-origin → network

  if (url.pathname.startsWith(OFFLINE_PATH_PREFIX)) {
    const videoId = decodeURIComponent(
      url.pathname.slice(OFFLINE_PATH_PREFIX.length).split("/")[0],
    )
    event.respondWith(
      caches
        .match(request, { cacheName: OFFLINE_CACHE_PREFIX + videoId })
        .then((hit) => hit || new Response("Not downloaded", { status: 404 })),
    )
    return
  }

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

// Web Push (see src/features/notifications/web-push.ts). The server sends
// `{ title, body, data }`, `data` being the notification's metadata (`kind`,
// ids, `notificationId`) — the same object a native push carries.
self.addEventListener("push", (event) => {
  let message = {}
  try {
    message = event.data ? event.data.json() : {}
  } catch {
    message = { body: event.data ? event.data.text() : "" }
  }
  const data = message.data || {}
  event.waitUntil(
    self.registration.showNotification(message.title || "Новое уведомление", {
      body: message.body || "",
      data,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      // One entry per notification row: a retried delivery replaces, not stacks.
      tag: data.notificationId || undefined,
    }),
  )
})

// A tap opens the screen the notification is about. The app routes it with the
// same rules as a native push tap (notification-route.ts): an open window gets
// the payload as a message (src/features/notifications/web-push-click.ts), a
// closed app is opened with it in `?push=`.
self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        const win = windows.find(
          (w) => new URL(w.url).origin === self.location.origin,
        )
        if (win) {
          win.postMessage({ type: "clubspace:push-click", data })
          // Focus is refused without a real tap (e.g. a scripted click); the
          // message has been delivered either way.
          return win.focus().catch(() => win)
        }
        return self.clients.openWindow(
          "/?push=" + encodeURIComponent(JSON.stringify(data)),
        )
      }),
  )
})
