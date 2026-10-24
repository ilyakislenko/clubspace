# syntax=docker/dockerfile:1.7
#
# Production image for the Next.js client web app (standalone output).
#
# NEXT_PUBLIC_* values are inlined at BUILD time, so the API URL must be
# supplied as a build arg (the compose file wires it from .env.production).
# Build context is the repo root.
#
#   docker build -f apps/client/Dockerfile \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.example.com -t clubspace-client .

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
ARG NEXT_PUBLIC_SUPPORT_EMAIL
ENV NEXT_PUBLIC_SUPPORT_EMAIL=${NEXT_PUBLIC_SUPPORT_EMAIL}
ARG NEXT_PUBLIC_LEGAL_OPERATOR
ENV NEXT_PUBLIC_LEGAL_OPERATOR=${NEXT_PUBLIC_LEGAL_OPERATOR}
ARG NEXT_PUBLIC_LEGAL_ADDRESS
ENV NEXT_PUBLIC_LEGAL_ADDRESS=${NEXT_PUBLIC_LEGAL_ADDRESS}
COPY --from=deps /workspace/node_modules ./node_modules
COPY . .
RUN npx nx build @clubspace/client

# ─── runtime ──────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN apk add --no-cache tini wget

COPY --from=builder /workspace/dist/apps/client/.next/standalone ./
COPY --from=builder /workspace/dist/apps/client/.next/static ./apps/client/.next/static
COPY --from=builder /workspace/apps/client/public ./apps/client/public

RUN chown -R node:node /app
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3000/sign-in >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/client/server.js"]
