# ClubSpace

Multi-tenant platform for training clubs. One install hosts many clubs
("workspace" = club), each with its own members, video library, schedule,
abonements and ranks. **Deliberately multi-discipline** — a workspace is
`GRAPPLING | FITNESS | YOGA | CUSTOM`, so keep new models sport-agnostic.

Auth is **passwordless email-OTP everywhere**. Nothing in the server ever reads
`User.password`; there is exactly one `bcrypt.compare` and it checks the emailed
code. Whoever controls the mailbox controls the account.

Nx monorepo: NestJS API, Next.js admin, Expo app (which also builds to an
installable PWA), an ffmpeg/HLS transcode worker, shared libs.

## Apps and libs

| Path | What it is |
| --- | --- |
| `apps/server` | The API. NestJS 11 + Prisma 7 + BullMQ. Vertical slices (`features/<slice>` = feature + handler + controller) over shared `domains/` services. OTP auth, JWT, RBAC, HLS playback tokens, reminder scheduler. |
| `apps/admin` | Next.js 16. Two tiers: the club panel (`/workspace/:id/…`) and the **platform console** (`/platform`) above it, for creating clubs and handing them to owners. |
| `apps/mobile` | Expo SDK 54. The member app — and the same code builds the browser PWA via react-native-web. |
| `apps/video-worker` | Consumes the `video-transcode` queue: raw upload → 3-rung HLS ladder → S3 → marks the video `ready`. |
| `apps/client` | Next.js web catalog. **Not wired into `npm run dev` or CI** — check before relying on it. |
| `libs/api-client` | Axios client + token store + 401-retry. **Generated `ApiTypes` come from `open-api.json`** and are drift-gated in CI. |
| `libs/prisma-client`, `libs/ui-kit` | Generated Prisma client (shared with the worker); shared UI components + themes. |

Infra: Postgres, Redis (queues + rate limits), S3-compatible storage (MinIO in
dev), SMTP (MailDev in dev).

## Run it

Needs Node 22 and Docker.

```sh
npm ci
cp .env.example .env
npm run dev          # infra → prisma push → API + admin + worker + Expo, one terminal
```

| | |
| --- | --- |
| API + docs | `http://localhost:3000` · `/api` · `/healthz` |
| Admin | `http://localhost:4200` |
| **MailDev — your OTP codes land here** | `http://localhost:1080` |
| MinIO console | `http://localhost:9001` (minioadmin/minioadmin) |

Pieces separately, if you don't want the whole stack:

```sh
npm run dev:infra                                   # postgres redis minio minio-init maildev
npx nx run @clubspace/server:prisma:prepare       # db push + generate
npx nx serve @clubspace/server                    # :3000
npx nx serve @clubspace/admin --port=4200
cd apps/mobile && npx expo start        # Expo dev server
```

### First login

Startup seeds only what the platform can't run without: roles, TFA groups, email
templates, and the **platform owner** — the account named by `SUPER_ADMIN_EMAIL`
(`admin@super.com` by default), created if missing and promoted if it already
exists. Change that variable and restart to promote a different address.

Sign in at `http://localhost:4200` with that email, take the code from MailDev,
and you land on `/platform`.

**Clubs are not seeded.** Create one in the console: name + owner's email. The
club is created and handed over; if that email has no account yet, one is made,
and the owner can sign in immediately (OTP — no password to communicate).
`SEED_DEMO_WORKSPACE=true` brings back the old sample grappling club for local
work.

### PWA build

```sh
cd apps/mobile
EXPO_PUBLIC_API_URL=http://localhost:3000 EXPO_PUBLIC_BRAND=grappling npm run build:pwa
npm run serve:pwa    # :4201
```

Both `EXPO_PUBLIC_*` are required — the build fails loudly without them, because
Metro inlines them at bundle time and they cannot be read at runtime.

## Tests and typecheck

One command answers "is this safe to merge?" — typecheck (5 projects), unit and
UI tests with coverage gates, and the generated-contract drift check:

```sh
npm run verify                # ~35s; the full gate
npm run verify -- --quick     # same minus lint, for a tight loop
npm run hooks:install         # run verify --quick on every git push (one-time)
```

Install the hook. GitHub Actions has been unavailable since the free-plan
minutes ran out, so `.github/workflows/ci.yml` does not run and this is the only
thing standing between a branch and `main`.

Individual suites:

```sh
npm run test:all              # server + admin + mobile unit/UI specs
npm run test:e2e              # real server + real database over HTTP
npx nx test @clubspace/server -- <substring>   # bare `jest` fails here
```

### The e2e suite

`apps/server-e2e` boots the whole `AppModule` in-process against a throwaway
`clubspace_e2e` database (created and schema-pushed automatically) and drives it
over HTTP with supertest. Needs `npm run dev:infra` running — Postgres and Redis
are real, not mocked.

Only the mail transport is replaced, and only so specs can read the OTP out of
the email that was actually rendered and dispatched. Everything else is
production: the guards, the Zod validation pipe, the serializer, the global
error filter. That's the point — a controller unit spec passed while `/readyz`
returned the right status with the wrong body, because the global filter
rewrote it. No amount of mocking finds that.

`verify` skips e2e with a loud warning when the infra isn't up, rather than
reporting a green tick for a suite that never ran.

### Coverage is gated, not reported

Each jest config carries a `coverageThreshold` ratchet set at the coverage that
actually exists. Adding code without tests drops the number below the floor and
fails the build even though every test passes. **Raise the floor in the same
commit that adds the tests** — a threshold left trailing behind reality stops
catching the case it exists for.

Both configs also set `collectCoverageFrom`. Without it jest instruments only
the files some test happened to import, so a feature with no spec is invisible
and the percentage describes the tested subset rather than the app. That
reported 84% on the server while 100 of 152 handlers were never loaded by a
single test.

Typecheck with `tsc` directly — the Nx targets are gated on a workspace-sync
check that's usually out of date:

```sh
npx tsc -p apps/server/tsconfig.app.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p apps/mobile/tsconfig.app.json --noEmit
```

**Mobile must use `tsconfig.app.json`.** Its plain `tsconfig.json` checks nothing
and reports clean on broken code; Metro strips types, so a bad type crashes at
runtime instead of at build.

## Contributing

`docs/conventions.md` is authoritative — read the section for the area you touch
and copy the nearest sibling file. Two rules that bite:

- **Schema changes go through `prisma db push`.** Do not create or commit
  `migrations/`.
- **If endpoints or DTOs change**, regenerate and commit `open-api.json` and
  `libs/api-client/src/openapi/*` in the same PR, or CI's drift gate fails.

## Deployment

```sh
cp .env.production.example .env.production   # fill in real secrets
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

The template documents every required secret: JWT and playback secrets must be
≥32 chars and distinct from each other, and `CORS_ORIGINS` must list explicit
origins (no wildcards). There are no admin passwords to set — see the auth note
at the top. A production install starts empty: the platform owner and nothing
else, no workspace, no sample data.

Admin is a standard Next.js build (`npx nx build @clubspace/admin`). The
mobile app ships via EAS (`eas.json`); the PWA is a static `dist-web/` served
over HTTPS with SPA fallback.

## License

[GNU AGPL v3](LICENSE). You may run, study, modify and redistribute ClubSpace
freely. The one obligation that matters in practice: **if you offer a modified
version to other people over a network, you must make your modified source
available to them** (AGPL §13). Self-hosting an unmodified copy for your own
club carries no such duty.

If those terms don't fit your use, open an issue — other arrangements are
possible.
