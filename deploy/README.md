# BJJ Academy — Production Deploy

One-host Docker Compose deploy for the NestJS API + Postgres + Redis behind
Caddy (auto-LE TLS). Targeted at a fresh Hetzner / DigitalOcean VPS.

## Prerequisites

- Ubuntu 22.04+ / Debian 12+ VPS with public IPv4
- DNS A-record `api.bjj-academy.ru` → server IP (must propagate *before*
  Caddy starts, otherwise ACME HTTP-01 fails)
- Docker Engine 24+ and the Compose v2 plugin
  (`curl -fsSL https://get.docker.com | sh`)
- Open ports 80 + 443 (UFW: `ufw allow 80,443/tcp && ufw allow 443/udp`)

## First-time bring-up

```bash
git clone https://github.com/<org>/bjj-academy.git
cd bjj-academy

# 1. Create the production env file from the production template (it documents
#    every required secret: PLAYBACK_TOKEN_SECRET, S3, REDIS_PASSWORD, etc.).
cp .env.production.example .env.production
# Then edit and set at minimum:
#   POSTGRES_PASSWORD=<strong random>
#   JWT_SECRET=$(openssl rand -hex 64)
#   ENCRYPTION_SECRET=$(openssl rand -hex 32)
#   SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD
#   ROOT_URL=https://api.bjj-academy.ru
#   JWT_ISSUER_URL / JWT_AUDIENCE_URL=https://api.bjj-academy.ru
#   CORS_ORIGINS=https://app.bjj-academy.ru,https://admin.bjj-academy.ru
#   SMTP_URL=smtps://user:pass@smtp.provider.com:465
#   S3_* (external bucket — AWS / Cloudflare R2 / Backblaze)

# 2. Build + start
docker compose -f docker-compose.prod.yml --env-file .env.production up -d

# 3. Tail logs until you see "Application is running on..."
docker compose -f docker-compose.prod.yml logs -f server

# 4. Verify
curl -sf https://api.bjj-academy.ru/healthz && echo OK
```

## Updates

```bash
git pull
docker compose -f docker-compose.prod.yml build server
docker compose -f docker-compose.prod.yml up -d server
docker image prune -f
```

The container runs `prisma db push` at startup, so a schema change in
`apps/server/prisma/schema.prisma` is applied automatically on the next
`up -d`. See *Caveats* below.

## Rollback

```bash
# Roll back to the previous git revision and rebuild.
git log --oneline -5
git checkout <previous-sha>
docker compose -f docker-compose.prod.yml build server
docker compose -f docker-compose.prod.yml up -d server
```

Data volumes are preserved across rebuilds — only the application image
is rolled back. For schema-incompatible rollbacks, restore from a pg_dump
backup first (see *Backups*).

## Backups

Nightly `pg_dump` to `/var/backups/bjj-academy/` with 14-day retention.
Add to `crontab -e` as root:

```cron
0 3 * * * docker compose -f /root/bjj-academy/docker-compose.prod.yml exec -T postgres pg_dump -U postgres -d bjj-academy --clean --if-exists | gzip > /var/backups/bjj-academy/db-$(date +\%F).sql.gz && find /var/backups/bjj-academy -name 'db-*.sql.gz' -mtime +14 -delete
```

Create the target dir once: `mkdir -p /var/backups/bjj-academy`.
For off-site copies, layer `rclone copy` onto an S3 bucket after the dump.

Restore:

```bash
gunzip -c /var/backups/bjj-academy/db-YYYY-MM-DD.sql.gz \
  | docker compose -f docker-compose.prod.yml exec -T postgres \
    psql -U postgres -d bjj-academy
```

## Caveats

- **`prisma db push` is destructive.** Once real users exist, schema changes
  that would drop columns will silently drop data (the Dockerfile passes
  `--accept-data-loss`). Plan to switch to `prisma migrate deploy` and start
  committing `apps/server/prisma/migrations/` before launch — track the
  cutover in a follow-up.
- Postgres and Redis are not exposed to the host. To open a `psql` shell:
  `docker compose -f docker-compose.prod.yml exec postgres psql -U postgres -d bjj-academy`.
- **Bucket access policy (important).** The bucket must be **private** so course
  videos can't be fetched by guessing a key — playback only works through the
  membership-checked manifest proxy, which signs short-lived segment URLs. Make
  only these two prefixes publicly readable (they hold non-sensitive assets the
  apps load directly): `thumbnails/*` and `subtitles/*`. Everything else
  (`hls/*`, `raw/*`) stays private. The dev MinIO stack sets exactly this in
  `docker-compose.yml` (`minio-init`); mirror it on your S3/R2 bucket (a bucket
  policy granting `s3:GetObject` on `arn:.../thumbnails/*` and `.../subtitles/*`
  to `*`, nothing else). Keep `S3_ACL=private`.
- Object storage is assumed external (AWS S3 / Cloudflare R2 / Backblaze).
  If you need self-hosted MinIO, add it to `docker-compose.prod.yml` and
  point `S3_UPLOAD_BUCKET_URL` at the internal service hostname.
- The `video-worker` IS now part of `docker-compose.prod.yml`.
- Caddy persists certificates in the `caddy_data` named volume — never
  delete that volume unless you want to re-issue from Let's Encrypt
  (subject to rate limits).
