# syntax=docker/dockerfile:1.7

# ─── Build stage ──────────────────────────────────────────────────────────────
# Node 22 LTS, pinned to a patch release and Alpine version so a rebuild is
# reproducible. Same tag in every app image — bump them together.
FROM node:22.23.4-alpine3.24 AS builder

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
FROM node:22.23.4-alpine3.24 AS runtime

WORKDIR /app
ENV NODE_ENV=production

# FFmpeg is required for HLS transcoding, ffprobe for vetting uploads first.
# The distro build, not the ffmpeg-static binary in node_modules: Alpine ships
# security fixes for it, and ffprobe has to come from the same build.
RUN apk add --no-cache ffmpeg
ENV FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe

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

# ffmpeg parses untrusted uploads, so it must not run as root. The image's
# built-in `node` user only needs to read /app and write its scratch dirs
# under /tmp.
USER node

CMD ["node", "apps/video-worker/src/main.js"]
