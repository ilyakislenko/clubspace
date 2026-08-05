# syntax=docker/dockerfile:1.7

# ─── Build stage ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /workspace

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY . .
# prisma.config.ts eagerly resolves env('DATABASE_URL') when the config loads,
# but `prisma generate` only reads the schema — it never connects to a DB. Give
# it a throwaway URL for the build (same as apps/server/Dockerfile). The worker
# gets its real DATABASE_URL from the environment at runtime.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    npx nx prisma:generate @clubspace/server
RUN npx nx build @clubspace/video-worker

# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

# FFmpeg is required for HLS transcoding
RUN apk add --no-cache ffmpeg

# Worker output is plain tsc to dist/apps/video-worker, preserving the nx
# source layout — the entrypoint lands at apps/video-worker/src/main.js and
# imports the generated prisma client from ./libs via relative .js paths.
COPY --from=builder /workspace/dist/apps/video-worker ./
COPY --from=builder /workspace/node_modules ./node_modules

# tsc emits the prisma-client sources to ./libs/prisma-client/src but not a
# package.json. The workspace alias `@clubspace/prisma-client` resolves to
# ./libs/prisma-client via the node_modules symlink; plain node (no tsx / TS path
# aliases) then needs an entry point there to load the compiled client.
RUN printf '{"type":"module","main":"src/index.js"}\n' > libs/prisma-client/package.json

CMD ["node", "apps/video-worker/src/main.js"]
