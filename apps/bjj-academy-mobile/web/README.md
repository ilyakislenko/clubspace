# Installable web build (PWA)

The same Expo/React-Native app, exported to the web via `react-native-web` and
wrapped as an installable PWA (manifest + service worker). Handy for letting
members in from a browser — and installing it to the home screen — while the app
store listings are pending.

## Build

```bash
EXPO_PUBLIC_API_URL=https://your-api.example.com \
EXPO_PUBLIC_BRAND=grappling \
npm run build:pwa
```

Output lands in `apps/bjj-academy-mobile/dist-web/` (static files). The
`EXPO_PUBLIC_*` values are **inlined at bundle time** (see `src/shared/env.ts`),
so set them for the build — there is no runtime config.

## Where the web-only files live

- **`public/`** — everything Expo copies verbatim into the export *and* serves
  from `expo start --web`, so dev and prod agree:
  - `index.html` — the HTML shell. Expo uses it as its template instead of the
    stock one, filling in `%LANG_ISO_CODE%` / `%WEB_TITLE%` and appending the
    bundle script. It carries the install manifest link, viewport/theme meta, the
    CSS baseline (dynamic viewport height, no page rubber-banding, focus rings,
    slim scrollbars) and the pre-JS boot splash. **Each Expo substitution takes
    the first match in the file — never write a placeholder name or a closing
    `head`/`body` tag above where it belongs, including inside comments.**
  - `manifest.webmanifest`, `service-worker.js`.
- **`scripts/build-pwa.mjs`** — only the things Expo can't produce: the resized
  install icons (192/512 + a maskable 512, via `sharp`), the local Plyr assets,
  the service-worker registration snippet (injected at build time only, so the
  dev server stays SW-free), and the service worker's per-build cache name +
  precache list (`__BUILD_ID__` / `__PRECACHE__`). The build id is derived from
  the emitted bundle filenames, so it changes exactly when the code does.

## Verifying a build locally

```bash
npm run build:pwa && npm run serve:pwa   # → http://localhost:4201
```

`serve-pwa.mjs` sends the headers a real host must (SPA fallback, `no-cache` on
the shell, `immutable` on `_expo/static/**`). Serving `dist-web/` with something
header-less (`python3 -m http.server`) makes the browser hold on to `index.html`,
so after a rebuild you get a blank page pointing at a deleted bundle — that
failure looks like an app bug and isn't one.

## Host

1. Serve `dist-web/` from any static host **over HTTPS** (Netlify, Vercel,
   Cloudflare Pages, S3+CloudFront, or the Nest server's static dir). HTTPS is
   required for the service worker and the install prompt. The host must serve
   `index.html` for unknown paths (SPA fallback).
2. On the **API server**, add the PWA's origin to `CORS_ORIGINS`
   (comma-separated) so browser requests are allowed, e.g.
   `CORS_ORIGINS=https://app.your-club.com`.
3. **Cache headers:** serve `index.html` and `service-worker.js` with
   `Cache-Control: no-cache` (revalidate every load) and the hashed
   `_expo/static/**` assets with `Cache-Control: public, max-age=31536000,
   immutable`. The service worker already fetches the shell with `cache:
   "reload"` as a safety net, but correct headers avoid a stale `index.html`
   pointing at a JS bundle a new deploy has removed (which shows a blank page
   until a hard reload).

Then members open the URL and use "Add to Home Screen" (iOS Safari) or the
install icon (Android/desktop Chrome).

## What works / degrades on web

- **Works:** sign-in (email code), courses & video, schedule, attendance &
  self-check-in, subscription, ranks, achievements, announcements, themes — the
  whole app renders through `react-native-web`.
- **Degrades gracefully:** native push notifications and offline video
  *downloads* are native-only and simply no-op in the browser. Video plays via
  the web player.

This is an interim distribution channel; the native store builds
(`expo run:ios` / `run:android`, EAS) are unchanged.
