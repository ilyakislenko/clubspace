# syntax=docker/dockerfile:1.7
#
# Multi-stage production build for the NestJS API server.
#
# Stages:
#   1. deps    — install full monorepo node_modules (cacheable)
#   2. builder — generate Prisma client, run `nx build server`
#   3. runtime — slim image with only built dist + production deps
#
# At container start the server runs `prisma db push` against the configured
# DATABASE_URL (per project memory: no migrations are committed while there
# is no prod data), then boots the compiled NestJS app.

# ─── Stage 1: deps ────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /workspace

# OS deps for native modules (bcrypt, etc.)
RUN apk add --no-cache python3 make g++ libc6-compat

# Copy only manifests for maximum layer cache reuse.
COPY package.json package-lock.json ./
COPY nx.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/video-worker/package.json apps/video-worker/
COPY libs/api-client/package.json libs/api-client/
COPY libs/prisma-client/package.json libs/prisma-client/
COPY libs/ui-kit/package.json libs/ui-kit/

RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# ─── Stage 2: builder ─────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /workspace
ENV NX_DAEMON=false

RUN apk add --no-cache python3 make g++ libc6-compat

# Pull installed node_modules from the deps stage.
COPY --from=deps /workspace/node_modules ./node_modules

# Copy the full source tree (apps/admin and apps/bjj-academy-mobile are
# excluded by .dockerignore — see apps/server/.dockerignore).
COPY . .

# Generate the Prisma client(s) and build the server bundle.
RUN npx nx run @bjj-academy/server:prisma:generate
RUN npx nx run @bjj-academy/server:build

# ─── Stage 3: runtime ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

# tini for proper PID-1 signal handling; wget for HEALTHCHECK; openssl for prisma.
RUN apk add --no-cache tini wget openssl

# Nx emits a slim package.json (`generatePackageJson: true`) into dist —
# we use that to install only production deps inside the runtime image.
COPY --from=builder /workspace/dist/apps/server ./

# Install runtime deps only.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# Pin the Prisma CLI in the image so container starts don't depend on
# npm registry connectivity. The version tracks @prisma/client in
# package.json — bump in lock-step.
RUN --mount=type=cache,target=/root/.npm \
    npm install --no-save --no-audit --no-fund prisma@7.2.0

# Prisma assets needed for `db push` at startup + generated client.
COPY --from=builder /workspace/apps/server/prisma ./prisma
COPY --from=builder /workspace/apps/server/src/infrastructure/prisma/generated ./generated
COPY --from=builder /workspace/libs/prisma-client/src/generated ./libs/prisma-client/src/generated

# Drop privileges — the `node` user ships with node:alpine.
RUN chown -R node:node /app
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "./node_modules/.bin/prisma db push --schema=./prisma/schema.prisma --accept-data-loss && node main.js"]
