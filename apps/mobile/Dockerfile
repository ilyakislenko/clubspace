# syntax=docker/dockerfile:1.7
#
# Production image for the installable web app (PWA) — the Expo app exported
# for the browser by scripts/build-pwa.mjs and served as static files. This is
# what pwa.<domain> serves: sign-in, schedule, video, offline lessons and Web
# Push. Native Android/iOS builds go through EAS, not this file.
#
# EXPO_PUBLIC_* values are inlined into the bundle at BUILD time, so the public
# URLs are build args (the compose file wires them from .env.production).
# Build context is the repo root.
#
#   docker build -f apps/mobile/Dockerfile \
#     --build-arg EXPO_PUBLIC_API_URL=https://api.example.com \
#     --build-arg EXPO_PUBLIC_WEB_URL=https://app.example.com -t clubspace-pwa .

# ─── deps ─────────────────────────────────────────────────────────────────────
# Node 22 LTS, pinned — same tag in every app image, bump them together.
FROM node:22.23.4-alpine3.24 AS deps
WORKDIR /workspace
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
# Without the workspace's own manifest `npm ci` prunes the packages only the
# app depends on (expo-audio & co.), and the export fails to resolve them.
COPY apps/mobile/package.json apps/mobile/
COPY libs/api-client/package.json libs/api-client/
COPY patches ./patches
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# ─── builder ──────────────────────────────────────────────────────────────────
FROM node:22.23.4-alpine3.24 AS builder
WORKDIR /workspace
ENV NX_DAEMON=false EXPO_NO_TELEMETRY=1 CI=1
# The neutral ClubSpace app: no club baked in, members join by code or link.
ENV EXPO_PUBLIC_BRAND=clubspace EXPO_PUBLIC_CLUB_PICKER=true
ARG EXPO_PUBLIC_API_URL
ENV EXPO_PUBLIC_API_URL=${EXPO_PUBLIC_API_URL}
# app.<domain>: the legal pages the app links to.
ARG EXPO_PUBLIC_WEB_URL
ENV EXPO_PUBLIC_WEB_URL=${EXPO_PUBLIC_WEB_URL}
ARG EXPO_PUBLIC_SUPPORT_EMAIL
ENV EXPO_PUBLIC_SUPPORT_EMAIL=${EXPO_PUBLIC_SUPPORT_EMAIL}
COPY --from=deps /workspace/node_modules ./node_modules
COPY . .
RUN cd apps/mobile && node scripts/build-pwa.mjs

# ─── runtime ──────────────────────────────────────────────────────────────────
# Static files only: a plain Caddy, no Node. TLS is the main Caddy's job.
FROM caddy:2-alpine AS runtime
COPY deploy/pwa.Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /workspace/apps/mobile/dist-web /srv
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/manifest.webmanifest > /dev/null 2>&1 || exit 1
