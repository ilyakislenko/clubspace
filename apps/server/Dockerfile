# syntax=docker/dockerfile:1.7

# ─── Build stage ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /workspace

# OS deps for native modules (bcrypt etc.)
RUN apk add --no-cache python3 make g++

# Install all deps based on the monorepo lockfile
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

# Copy the rest of the monorepo and build the server
COPY . .
RUN npx nx prisma:generate @bjj-academy/server
RUN npx nx build @bjj-academy/server

# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

# Copy built server (Nx generates a slim package.json here)
COPY --from=builder /workspace/dist/apps/server ./

# Install only runtime deps inside the slim package
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts

# Prisma generated client and migration assets
COPY --from=builder /workspace/apps/server/prisma ./prisma
COPY --from=builder /workspace/apps/server/src/infrastructure/prisma/generated ./generated
COPY --from=builder /workspace/libs/prisma-client/src/generated ./libs/prisma-client/src/generated

EXPOSE 3000

# Sync schema to DB on startup, then run the API.
# Switch to `migrate deploy` once a migrations/ directory is committed.
CMD ["sh", "-c", "npx --yes prisma@7 db push --schema=./prisma/schema.prisma --accept-data-loss && node main.js"]
