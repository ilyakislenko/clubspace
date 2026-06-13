# syntax=docker/dockerfile:1.7

# ─── Build stage ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /workspace

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY . .
RUN npx nx prisma:generate @bjj-academy/server
RUN npx nx build @bjj-academy/video-worker

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

CMD ["node", "apps/video-worker/src/main.js"]
