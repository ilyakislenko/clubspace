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

## Host

1. Serve `dist-web/` from any static host **over HTTPS** (Netlify, Vercel,
   Cloudflare Pages, S3+CloudFront, or the Nest server's static dir). HTTPS is
   required for the service worker and the install prompt. The host must serve
   `index.html` for unknown paths (SPA fallback).
2. On the **API server**, add the PWA's origin to `CORS_ORIGINS`
   (comma-separated) so browser requests are allowed, e.g.
   `CORS_ORIGINS=https://app.your-club.com`.

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
