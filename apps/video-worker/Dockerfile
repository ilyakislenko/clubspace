# syntax=docker/dockerfile:1.7

# Optional whisper.cpp (auto subtitles, speech chapters, technique mentions
# from speech): WITH_WHISPER=1 compiles its CLI into the image; 0 (default)
# keeps the image small and the speech steps off. The model is not baked in —
# it lives on the whisper_models volume (deploy/README.md, «Расшифровка речи»).
ARG WITH_WHISPER=0

# ─── whisper.cpp ──────────────────────────────────────────────────────────────
# Built on the runtime's own base image, so musl and libstdc++ match. Portable
# CPU build for amd64 and arm64: every CPU variant of the ggml backend is
# compiled (x86: SSE4.2 … AVX-512/AMX; ARM: armv8.0 … armv9.2) and whisper-cli
# loads the best one for the CPU it runs on — an image built on one host runs
# on another, an old home-server CPU without AVX2 included. No OpenMP: ggml's
# own thread pool, so no libgomp at runtime.
FROM node:22.23.5-alpine3.24 AS whisper-1

# Pinned release; bump the version and its checksum together.
ARG WHISPER_CPP_VERSION=1.9.6
ARG WHISPER_CPP_SHA256=7ab15dc88022d2425ad94dcffd8abbf1b6d7018089b4e48d6b40780738e0b445

RUN apk add --no-cache build-base cmake linux-headers

WORKDIR /src
RUN wget -q -O whisper.tar.gz \
        "https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v${WHISPER_CPP_VERSION}.tar.gz" \
    && echo "${WHISPER_CPP_SHA256}  whisper.tar.gz" | sha256sum -c - \
    && tar -xzf whisper.tar.gz --strip-components=1 \
    && rm whisper.tar.gz
# Shared libraries with an $ORIGIN rpath: the CPU variants are plugins loaded
# from whisper-cli's own directory, so everything lives flat in /opt/whisper.
RUN cmake -S . -B build \
        -DCMAKE_BUILD_TYPE=Release \
        -DBUILD_SHARED_LIBS=ON \
        -DCMAKE_BUILD_RPATH_USE_ORIGIN=ON \
        -DGGML_NATIVE=OFF \
        -DGGML_BACKEND_DL=ON \
        -DGGML_CPU_ALL_VARIANTS=ON \
        -DGGML_OPENMP=OFF \
        -DWHISPER_BUILD_TESTS=OFF \
        -DWHISPER_BUILD_SERVER=OFF \
        -DWHISPER_SDL2=OFF \
        -DWHISPER_CURL=OFF \
    && cmake --build build --target whisper-cli -j"$(nproc)" \
    && mkdir -p /opt/whisper \
    && cp -P build/bin/whisper-cli build/bin/*.so* /opt/whisper/ \
    && find /opt/whisper -type f -exec strip --strip-unneeded {} + \
    && /opt/whisper/whisper-cli --help > /dev/null 2>&1

# Without whisper: an empty directory, so the runtime stage is the same.
FROM node:22.23.5-alpine3.24 AS whisper-0
RUN mkdir -p /opt/whisper

FROM whisper-${WITH_WHISPER} AS whisper

# ─── Build stage ──────────────────────────────────────────────────────────────
# Node 22 LTS, pinned to a patch release and Alpine version so a rebuild is
# reproducible. Same tag in every app image — bump them together.
FROM node:22.23.5-alpine3.24 AS builder

WORKDIR /workspace

RUN apk add --no-cache python3 make g++

# The workspace manifests must be present when npm ci runs, or it creates no
# node_modules/@clubspace/* links and the runtime import of
# @clubspace/prisma-client fails with ERR_MODULE_NOT_FOUND. Same set as
# apps/server/Dockerfile.
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/video-worker/package.json apps/video-worker/
COPY libs/api-client/package.json libs/api-client/
COPY libs/prisma-client/package.json libs/prisma-client/
COPY libs/sport-glossary/package.json libs/sport-glossary/
RUN --mount=type=cache,target=/root/.npm npm ci

# No Nx daemon or Nx Cloud inside a one-shot image build (see apps/admin/Dockerfile).
ENV NX_DAEMON=false NX_NO_CLOUD=true
COPY . .
# prisma.config.ts eagerly resolves env('DATABASE_URL') when the config loads,
# but `prisma generate` only reads the schema — it never connects to a DB. Give
# it a throwaway URL for the build (same as apps/server/Dockerfile). The worker
# gets its real DATABASE_URL from the environment at runtime.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    npx nx prisma:generate @clubspace/server
RUN npx nx build @clubspace/video-worker
# The runtime runs plain node on the tsc output (no tsx, jest, nx), and every
# package it imports is a root `dependency` — drop the devDependencies before
# node_modules is copied into the runtime image. `COPY . .` brought the other
# apps' manifests in; prune reifies every workspace it sees, so remove them
# first or it would install Next/Expo into this image.
RUN rm -rf apps/admin apps/client apps/mobile && npm prune --omit=dev

# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM node:22.23.5-alpine3.24 AS runtime

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

# Same for libs/sport-glossary (an ESM workspace package; tsc emits it to
# ./libs/sport-glossary/src, the node_modules symlink comes from npm ci).
RUN printf '{"type":"module","main":"src/index.js"}\n' > libs/sport-glossary/package.json

# Chapter OCR (src/chapter-ocr.ts) runs tesseract.js — WebAssembly, no system
# package — with its English model from @tesseract.js-data/eng, both in the
# node_modules copied above. The worker never downloads the model, so fail the
# build rather than ship an image without it.
RUN test -s node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz

# whisper-cli and its libraries with WITH_WHISPER=1; an empty directory
# otherwise. On PATH, where the worker looks by default (WHISPER_CLI_PATH).
# Needs only musl and libstdc++, both already in the base image. Last, so
# both variants share every layer above.
COPY --from=whisper /opt/whisper /opt/whisper
RUN if [ -e /opt/whisper/whisper-cli ]; then ln -s /opt/whisper/whisper-cli /usr/local/bin/whisper-cli; fi

# ffmpeg parses untrusted uploads, so it must not run as root. The image's
# built-in `node` user only needs to read /app and write its scratch dirs
# under /tmp.
USER node

CMD ["node", "apps/video-worker/src/main.js"]
