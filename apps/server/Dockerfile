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
# NB: libs/ui-kit is a tsconfig-path-only lib (no package.json) and isn't
# imported by the server, so it's intentionally not copied here. Adding a
# `COPY libs/ui-kit/package.json` line back will break the build — the file
# doesn't exist.

RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# ─── Stage 2: builder ─────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /workspace
ENV NX_DAEMON=false

RUN apk add --no-cache python3 make g++ libc6-compat

# Pull installed node_modules from the deps stage.
COPY --from=deps /workspace/node_modules ./node_modules

# Copy the full source tree (apps/admin and apps/mobile are
# excluded by .dockerignore — see apps/server/.dockerignore).
COPY . .

# Generate the Prisma client(s) and build the server bundle.
# prisma.config.ts eagerly resolves env('DATABASE_URL') when the config loads,
# but `prisma generate` only reads the schema — it never connects to a DB. Give
# it a throwaway URL for the build; the real DATABASE_URL is injected at
# container start for `prisma db push` (and stays strict there on purpose).
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    npx nx run @clubspace/server:prisma:generate
RUN npx nx run @clubspace/server:build

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
# Nx's generatePackageJson emits a *pruned* package-lock.json that `npm ci`
# rejects: the monorepo graph pulls multiple versions of a transitive dep
# (e.g. domhandler 3.x vs 4.x), and the pruned lock ends up internally
# inconsistent. Drop the pruned lock and resolve from the generated
# package.json instead — Nx pins exact versions there, so it stays reproducible.
RUN --mount=type=cache,target=/root/.npm \
    rm -f package-lock.json && \
    npm install --omit=dev --ignore-scripts --no-audit --no-fund

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
# Prisma 7's `db push` no longer reads the datasource URL from the schema's
# env("DATABASE_URL") — it requires an explicit URL (via prisma.config.ts, which
# isn't shipped in this slim image, or --url). Pass the container's DATABASE_URL
# directly; compose injects it.
#
# Deliberately WITHOUT --accept-data-loss. Additive changes (new tables, new
# columns with defaults) apply on boot as before; a change that would drop a
# column or table makes `db push` refuse and exit, so the container stops with
# Prisma's explanation in the logs instead of silently deleting student data.
# Applying such a change is a decision: take a fresh backup, then run it by hand
# (deploy/README.md → "A schema change refused to apply").
CMD ["sh", "-c", "./node_modules/.bin/prisma db push --schema=./prisma/schema.prisma --url \"$DATABASE_URL\" && node main.js"]
