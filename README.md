# BJJ Academy

A multi-tenant ("workspace" = club) platform for Brazilian Jiu-Jitsu / grappling
academies: passwordless email-OTP auth, an HLS video library with courses and
chapters, club members with access windows, groups/gyms with schedules, events,
an audit journal, and email/push notifications.

It's an [Nx](https://nx.dev) monorepo: a NestJS API, an Expo (React Native)
student app, two Next.js web apps (admin + client), a standalone ffmpeg/HLS
transcode worker, and shared libraries.

## Architecture

### Apps (`apps/`)

| App | Stack | What it is |
| --- | --- | --- |
| `server` | NestJS 11, Prisma 7 (pg adapter), BullMQ | The API. Vertical-slice features (`features/<slice>` = controller + zod schema + handler) over shared domain services (`domains/`). OTP auth, JWT access/refresh, RBAC, the HLS playback-token proxy, the reminder scheduler. |
| `bjj-academy-mobile` | Expo SDK 54 / React Native | The student app: sign-in, course catalog, HLS playback (expo-video), offline downloads, schedule. |
| `admin` | Next.js 16 | The club operator panel: video upload, course builder (dnd-kit), members, groups/gyms, events, audit journal, settings. |
| `client` | Next.js 16 | The web student experience: catalog + HLS web playback (hls.js + Plyr), legal pages, DMCA report form. |
| `video-worker` | Node + ffmpeg-static | Consumes the `video-transcode` BullMQ queue: downloads the raw upload, produces a 3-rung HLS ladder, uploads segments to S3, flips the video to `ready`. |
| `server-e2e` | Jest | Server end-to-end scaffold. |

### Libraries (`libs/`)

| Lib | What it is |
| --- | --- |
| `api-client` | Axios HTTP client with a token store, proactive refresh, and a 401-retry interceptor. Shared by all three frontends. |
| `prisma-client` | The generated Prisma client, shared with the worker. |
| `ui-kit` | Shared React UI components (shadcn-style) + brand config. |

### Infrastructure

PostgreSQL, Redis (BullMQ queues + rate limiting), and S3-compatible object
storage (MinIO in dev, any S3/R2 in prod) for raw uploads and HLS output. SMTP
for OTP/notification email (MailDev in dev).

## Prerequisites

- Node.js 22 and npm
- Docker + Docker Compose (for Postgres / Redis / MinIO / MailDev)

## Local development

```sh
# 1. Install dependencies
npm ci

# 2. Configure environment
cp .env.example .env        # adjust if needed

# 3. Start infra (Postgres, Redis, MinIO, MailDev)
docker compose up -d postgres redis minio maildev

# 4. Generate the Prisma client and push the schema
npx nx prisma:generate @bjj-academy/server
npx prisma db push --schema apps/server/prisma/schema.prisma

# 5. Run the apps you need (separate terminals)
npx nx serve @bjj-academy/server
npx nx serve @bjj-academy/admin
npx nx serve @bjj-academy/client
npx nx serve @bjj-academy/video-worker
(cd apps/bjj-academy-mobile && npx expo start)   # Expo dev server
```

The server bootstraps first-run seed data (roles, email templates, a super
admin, and a default workspace) on startup. Dev credentials come from `.env`
(`SUPER_ADMIN_*`, `DEFAULT_WORKSPACE_ADMIN_*`); in production those passwords are
**required** — the server refuses to boot without them.

- API + Scalar API reference: `http://localhost:3000` and `/api`
- MailDev (catches OTP emails): `http://localhost:1080`
- MinIO console: `http://localhost:9001`

Alternatively, `docker compose up` runs the full dev stack (including `server`
and `video-worker`) in containers.

## Testing

```sh
npm run test:all        # server + mobile unit tests
npm run test:server
npm run test:mobile
npm run test:coverage
```

Or per project: `npx nx test @bjj-academy/server`. Typecheck a project with
`npx tsc --noEmit -p apps/<app>/tsconfig.app.json` (admin/client use
`tsconfig.json`).

## Deployment

The production stack is `docker-compose.prod.yml` (Postgres, Redis, the API, the
video-worker, and Caddy for auto-TLS):

```sh
cp .env.production.example .env.production   # fill in REAL secrets
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

`.env.production.example` documents every required secret (JWT/playback secrets
must be ≥32 chars and distinct, admin passwords are required, CORS must list
explicit origins). The admin and client web apps are standard Next.js builds
(`npx nx build @bjj-academy/admin`) and can be hosted on any Next-compatible
host. The mobile app ships via EAS (`eas.json`).

## Repository layout

```
apps/        server, bjj-academy-mobile, admin, client, video-worker, server-e2e
libs/        api-client, prisma-client, ui-kit
deploy/      Caddyfile and deployment notes
docker-compose.yml          dev stack
docker-compose.prod.yml     production stack
```
