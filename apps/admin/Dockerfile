# syntax=docker/dockerfile:1.7
#
# Production image for the Next.js admin panel (standalone output).
#
# NOTE: NEXT_PUBLIC_* values are inlined into the client bundle at BUILD time,
# so the API URL must be supplied as a build arg (the compose file wires it
# from .env.production). Build context is the repo root.
#
#   docker build -f apps/admin/Dockerfile \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.example.com -t bjj-admin .

# ─── deps ─────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /workspace
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# ─── builder ──────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /workspace
ENV NX_DAEMON=false NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
COPY --from=deps /workspace/node_modules ./node_modules
COPY . .
RUN npx nx build @bjj-academy/admin

# ─── runtime ──────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
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
