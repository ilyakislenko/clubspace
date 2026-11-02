# syntax=docker/dockerfile:1.7
#
# Production image for the Next.js admin panel (standalone output).
#
# NOTE: NEXT_PUBLIC_* values are inlined into the client bundle at BUILD time,
# so the API URL must be supplied as a build arg (the compose file wires it
# from .env.production). Build context is the repo root.
#
#   docker build -f apps/admin/Dockerfile \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.example.com -t clubspace-admin .

# ─── deps ─────────────────────────────────────────────────────────────────────
# Node 22 LTS, pinned — same tag in every app image, bump them together.
FROM node:22.23.4-alpine3.24 AS deps
WORKDIR /workspace
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
# Without the app's own manifest `npm ci` prunes the packages only the admin
# depends on (socket.io-client), and the build fails to resolve them.
COPY apps/admin/package.json apps/admin/
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# ─── builder ──────────────────────────────────────────────────────────────────
FROM node:22.23.4-alpine3.24 AS builder
WORKDIR /workspace
# NX_NO_CLOUD: nx.json carries the repo's Nx Cloud id; a server build must not
# call out to it (no access token here — a 401 that buries the real error).
ENV NX_DAEMON=false NX_NO_CLOUD=true NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
COPY --from=deps /workspace/node_modules ./node_modules
COPY . .
# The build first compiles libs/api-client (dependsOn ^build): the typecheck
# needs its .d.ts, and a fresh checkout has none. --skip-sync: Nx's tsconfig
# reference check covers unrelated projects and only fails here, where it
# cannot prompt; a build never rewrites the sources.
RUN npx nx build @clubspace/admin --skip-sync

# ─── runtime ──────────────────────────────────────────────────────────────────
FROM node:22.23.4-alpine3.24 AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN apk add --no-cache tini wget

# Next standalone bundle preserves the workspace layout: server.js lands at
# apps/admin/server.js with its traced node_modules alongside.
COPY --from=builder /workspace/dist/apps/admin/.next/standalone ./
# Static assets + public/ must sit next to the app's server.js.
COPY --from=builder /workspace/dist/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=builder /workspace/apps/admin/public ./apps/admin/public

RUN chown -R node:node /app
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3000/sign-in >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/admin/server.js"]
