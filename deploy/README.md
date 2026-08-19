# ClubSpace — Production Deploy

One-host Docker Compose deploy: the NestJS API, Postgres, Redis, MinIO object
storage, the video worker, the admin panel and the student web app, all behind
Caddy with automatic Let's Encrypt TLS. Sized for a home server or a small VPS.

Read this top to bottom the first time. The steps are ordered so nothing is
referenced before it exists.

## Prerequisites

- A host with Docker Engine 24+ and the Compose v2 plugin
  (`curl -fsSL https://get.docker.com | sh`). Ubuntu 22.04+ / Debian 12+.
- **Ports 80 and 443** either free for the bundled Caddy, or already owned by a
  reverse proxy you keep (nginx-proxy-manager, Traefik, nginx) — see *Behind an
  existing reverse proxy* below. `deploy/init.sh` detects which and picks the
  matching mode.
- **A public IPv4 that reaches this host on ports 80 and 443.** On a home
  connection, verify all three before going further:
  - the address in the router's WAN status equals `curl -s ifconfig.me`
    (if it does not, the ISP has you behind CGNAT and port forwarding cannot
    work — you need a tunnel or a small VPS in front);
  - ports 80 and 443 are forwarded to this host
    (`ufw allow 80,443/tcp && ufw allow 443/udp`);
  - port 80 is not blocked upstream. Caddy proves domain ownership over HTTP-01
    on port 80; if the ISP blocks it, no certificate is ever issued.
- **Four A-records, all pointing at this host, all resolving before first start:**

  | Record | Serves | Why it cannot be skipped |
  |---|---|---|
  | `api.<domain>` | the NestJS API | every client call |
  | `admin.<domain>` | the admin panel | where you run the club |
  | `app.<domain>` | the student web app | the browser alternative to the APK |
  | `s3.<domain>` | object storage | uploads and video segments go **directly** here on presigned URLs; the API never proxies them |

  Caddy requests a certificate per hostname at startup. A record that does not
  resolve yet means that one site stays down while the others work — and failed
  validations count against Let's Encrypt's rate limit, so premature starts are
  not free. `deploy/init.sh` checks all four for you before touching Docker.
- A working outbound SMTP relay — see *Email* below. Not optional.

**A note on home uplink.** Students stream video from this box. A 720p viewer
costs ~2.5 Mbit/s, so a 30 Mbit/s uplink carries roughly eight at once. If yours
is slower or the group grows, move MinIO to a small VPS — no code changes, only
the `s3.` record and a data copy. Also enable SQM / fq_codel on the router if it
offers it: without it, one person watching video adds seconds of latency to
everything else in the house.

## Email

Sign-in is an emailed OTP; `/readyz` fails when the transport is unusable.
Sending directly from a residential IP will land in spam, so use a relay
(Resend, Postmark, Brevo, Yandex 360 — any of them). Set `SMTP_URL` and
`SMTP_NO_REPLY_EMAIL`, and add SPF, DKIM and DMARC records for the domain,
or Gmail will quietly bin the codes.

## First-time bring-up

```bash
git clone https://github.com/<org>/clubspace.git
cd clubspace

./deploy/init.sh \
  --domain your-domain.com \
  --admin-email you@example.com \
  --smtp-url 'smtps://user:pass@smtp.provider.com:465'
```

That checks DNS, generates every secret, writes `.env.production` with mode
0600, builds and starts the stack, waits until `/readyz` reports ok, and prints
the club key to use in the next section.

Useful flags: `--club-key <key>` to choose the club key yourself (default: the
domain's first label), `--skip-dns` when the host is not publicly reachable yet,
`--dry-run` to see the generated env file without writing anything.

Re-running is refused once `.env.production` exists. Those secrets sign the live
sessions and encrypt stored data, so regenerating them would sign everyone out
of a working install. `--force` overrides, and is almost never what you want.

### Exposing only this stack, on a host that runs other things

A home server usually already serves a few private things — photos, dashboards,
automation — behind a reverse proxy on 80/443. Opening those ports on the router
would put **all of it** on the internet, which is rarely what anyone wants.

Give this stack its own Caddy on different host ports and let the router decide
what the outside world reaches:

```bash
./deploy/init.sh --domain your-domain.com --caddy-ports 8080:8443 ...
```

Then forward, on the router, external `80 -> 8080` and `443 -> 8443`. The result:

- the internet reaches this stack and nothing else — the existing proxy keeps
  listening on 80/443, but the router never hands it a packet from outside;
- public URLs stay clean, with no port in them, because the translation happens
  at the router;
- certificates still issue, since ACME HTTP-01 arrives on external 80.

Note that verifying from the server itself may fail even when everything works:
many home routers will not send a machine's own traffic back in through the
public address. Check from elsewhere — a phone on mobile data is enough.

### When the ISP blocks 443

Residential connections often drop inbound 80 and 443 while passing everything
else. Check before assuming the worst — and check from somewhere that is not
your own network, since a VPN or a router that does not hairpin will lie to you.
`https://check-host.net/check-tcp?host=<ip>:443` probes from several countries.
Read the answers carefully: *connection refused* means the packets arrive and
nothing is listening, which is good news; *timed out* means they are dropped.

If a high port answers and 443 does not, serve on the high port:

```bash
./deploy/init.sh --domain your-domain.com --public-port 8443 ...
```

Three things follow from that, all of them mandatory:

- **The reverse proxy must listen on that port on the host**, not only on the
  router. The stack resolves the storage hostname to the Docker host and reaches
  it on the very port the public URL names — a port that exists only as a
  router-side translation works from the internet and fails from inside.
- **Certificates must come from the DNS challenge.** ACME HTTP-01 needs port 80,
  which is exactly what is blocked. nginx-proxy-manager and Caddy both support
  DNS challenges, DuckDNS included.
- **The port is baked into the app build**: pass `--public-port` to
  `scripts/set-mobile-target.sh` as well, or the APK will call the wrong origin.

Once the ISP opens 443, drop `--public-port`, rebuild the web images and the
APK, and the URLs go back to normal.

### Behind an existing reverse proxy

If the host already serves other things on 80/443, the bundled Caddy cannot bind
them. `init.sh` notices and switches to overlay mode automatically
(`--behind-proxy` forces it, `--with-caddy` forces the other way). The overlay
joins your proxy's Docker network — `shared-net` by default, override with
`PROXY_NETWORK=<name>` — and publishes no host ports at all, so nothing of this
stack is exposed on the LAN.

Add four proxy hosts, all plain HTTP; your proxy terminates TLS:

| Hostname | Target |
|---|---|
| `api.<domain>` | `http://clubspace-api:3000` |
| `admin.<domain>` | `http://clubspace-admin:3000` |
| `app.<domain>` | `http://clubspace-app:3000` |
| `s3.<domain>` | `http://clubspace-s3:9000` |

**On the `s3.` host, lift the upload limit.** nginx caps request bodies by
default, and video uploads go through this host — a large file is cut off
mid-flight with no useful error. In nginx-proxy-manager's *Advanced* box:

```
client_max_body_size 0;
proxy_request_buffering off;
```

Running the compose commands yourself in this mode means passing both files:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.proxy.yml \
  --env-file .env.production up -d
```

<details>
<summary>Doing it by hand instead</summary>

```bash
cp .env.production.example .env.production
# Fill in DOMAIN, ACME_EMAIL, the passwords and secrets, SUPER_ADMIN_EMAIL and SMTP_URL.
# Generate secrets with: openssl rand -hex 64  (32 for ENCRYPTION_SECRET)
docker compose -f docker-compose.prod.yml --profile caddy \
  --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml logs -f server
```

Everything hostname-shaped — `ROOT_URL`, the JWT issuer and audience,
`CORS_ORIGINS`, the API URL baked into the web bundles and the S3 endpoint — is
derived from `DOMAIN` in `docker-compose.prod.yml`. Setting those in the env
file has no effect.

The server refuses to start if `JWT_SECRET` or `PLAYBACK_TOKEN_SECRET` is under
32 characters or if the two are equal — deliberately, since a weak or shared
signing secret silently accepts forged tokens and playback URLs.

There is no admin password to set anywhere. Sign-in is OTP-only.
</details>

## Verify

```bash
# Liveness — the process is up.
curl -sf https://api.<domain>/healthz && echo OK

# Readiness — db, redis, smtp and the video worker are all usable. Check this
# after every deploy: a broken SMTP config locks everyone out while the app
# looks perfectly healthy.
curl -s https://api.<domain>/readyz | tee /dev/stderr | grep -q '"status":"ok"' \
  && echo READY || echo 'NOT READY — see checks above'

# Storage is published and the bucket policy is right. The first must NOT be
# 200 (private), the second must not be 403 (thumbnails are read anonymously).
curl -s -o /dev/null -w 'hls: %{http_code}\n' https://s3.<domain>/clubspace/hls/probe
curl -s -o /dev/null -w 'thumbnails: %{http_code}\n' https://s3.<domain>/clubspace/thumbnails/probe

# The bucket bootstrap ran.
docker compose -f docker-compose.prod.yml logs minio-init
```

A `403` on the `thumbnails/` probe means `minio-init` did not finish — rerun it
with `docker compose -f docker-compose.prod.yml up minio-init`.

## Your club, and the first students

1. **Sign in to the admin panel** at `https://admin.<domain>` with
   `SUPER_ADMIN_EMAIL`. The code arrives by email — there is no password.
2. **Create the club** in the platform console at `/platform`: name plus owner
   email. Note the **key** it generates (a Cyrillic name is transliterated —
   "Академия БЖЖ" becomes `akademiya_bzhzh`). You can edit the key there.
3. **Put that key in the app build**, on the machine that builds the APK:

   ```bash
   ./scripts/set-mobile-target.sh --domain <domain> --club-key <key>
   ```

   This step is not optional and it fails quietly if you skip it: a student
   signing in with the wrong key is attached to no club at all. They will see a
   successful login and an empty app, and they will not appear in your pending
   list. There is nothing in the logs to tell you why.

4. **Build and hand out the APK:**

   ```bash
   cd apps/mobile
   npx eas build --profile production --platform android
   ```

   EAS generates a signing keystore on the first build. **Save it**
   (`npx eas credentials`). Lose it and no future build can install over the one
   your students already have — they would have to delete the app first.

   Students need "install from unknown sources" enabled for whatever app opens
   the file. Play Protect will warn about an unknown developer; that is expected
   for a hand-distributed build.

5. **Two ways in for the first group** — pick either:

   - **They sign themselves up.** Each opens the app, enters their email, gets a
     code. This creates an `INVITED` membership in your club, which shows up in
     the admin under *Пользователи* → «Ожидают одобрения». Press «Принять» and
     they become full members. Best when you want to confirm each person.
   - **You add them first.** In the admin, import a list of emails. Each becomes
     an `ACTIVE` member immediately, and they just sign in. Faster for a known
     group, and nobody waits on your approval. Importing an email that already
     has a pending membership promotes it, so the two paths mix safely.

6. **Upload a video and watch it back on a phone** before telling anyone the app
   is ready. This is the only check that exercises the whole chain at once:
   presigned upload to storage → worker transcode → manifest proxy → segment
   playback. If the `s3.` record or the bucket policy is wrong, this is where you
   find out, not the students.

## Known gaps at first install

- **Push notifications do not arrive.** The server sends through Expo's push
  service, but an Android build needs FCM credentials uploaded to your EAS
  project first. Without them the app registers no token and fails silently by
  design — nothing crashes, notifications simply never appear.
- **`prisma db push` runs on every container start** with `--accept-data-loss`.
  Now that real students exist, a schema change that drops a column drops their
  data with it. Take the backups below seriously, and look at what `db push`
  plans to do before deploying a schema change.
- **Video is capped at 720p.** The HLS ladder deliberately omits a 1080p rung so
  a home uplink can serve several viewers at once. Restore it in
  `apps/video-worker/src/main.ts` when egress no longer rides that link.

## Updates

```bash
git pull
docker compose -f docker-compose.prod.yml build server
docker compose -f docker-compose.prod.yml up -d server
docker image prune -f
```

The container runs `prisma db push` at startup, so a schema change in
`apps/server/prisma/schema.prisma` is applied automatically on the next
`up -d`. See *Caveats*.

`NEXT_PUBLIC_API_URL` is baked into the web bundles at build time, so rebuild
the `admin` and `client` images whenever the domain changes:
`docker compose -f docker-compose.prod.yml build admin client`.

## Rollback

```bash
git log --oneline -5
git checkout <previous-sha>
docker compose -f docker-compose.prod.yml build server
docker compose -f docker-compose.prod.yml up -d server
```

Data volumes are preserved across rebuilds — only the application image is
rolled back. For schema-incompatible rollbacks, restore from a dump first.

## Backups

Two things need backing up, and losing either one is unrecoverable: the database
(accounts, memberships, progress, schedule) and the object store (every video
anyone uploaded).

```bash
mkdir -p /var/backups/clubspace
```

`crontab -e` as root:

```cron
# Database, nightly, 14-day retention.
0 3 * * * docker compose -f /root/clubspace/docker-compose.prod.yml exec -T postgres pg_dump -U postgres -d clubspace --clean --if-exists | gzip > /var/backups/clubspace/db-$(date +\%F).sql.gz && find /var/backups/clubspace -name 'db-*.sql.gz' -mtime +14 -delete

# Object store, weekly — it is large and changes only when a video is added.
0 4 * * 0 docker run --rm -v clubspace_minio_data:/data:ro -v /var/backups/clubspace:/backup alpine tar czf /backup/minio-$(date +\%F).tar.gz -C /data . && find /var/backups/clubspace -name 'minio-*.tar.gz' -mtime +30 -delete
```

Both land on the same disk as the thing they protect, which does not survive
that disk dying. Add an off-site copy — `rclone copy /var/backups/clubspace
remote:` on any cheap object store — before you rely on this.

Restore the database:

```bash
gunzip -c /var/backups/clubspace/db-YYYY-MM-DD.sql.gz \
  | docker compose -f docker-compose.prod.yml exec -T postgres psql -U postgres -d clubspace
```

Restore the object store into a stopped stack:

```bash
docker compose -f docker-compose.prod.yml stop minio
docker run --rm -v clubspace_minio_data:/data -v /var/backups/clubspace:/backup alpine \
  sh -c 'rm -rf /data/* && tar xzf /backup/minio-YYYY-MM-DD.tar.gz -C /data'
docker compose -f docker-compose.prod.yml start minio
```

## Caveats

- **`prisma db push` is destructive.** The Dockerfile passes
  `--accept-data-loss`, so a schema change that would drop a column drops the
  data in it, silently. This project does not keep a migration history; the
  nightly dump above is the safety net.
- **Postgres, Redis and MinIO are not exposed to the host.** They are reachable
  only on the internal `bjj_net` network. For a `psql` shell:
  `docker compose -f docker-compose.prod.yml exec postgres psql -U postgres -d clubspace`.
  MinIO's console (9001) is deliberately unpublished as well; use
  `docker compose -f docker-compose.prod.yml exec minio mc ...` for one-off
  commands, or forward the port over SSH if you want the web UI.
- **Bucket access policy.** The bucket is **private** so course videos cannot be
  fetched by guessing a key — playback works only through the membership-checked
  manifest proxy, which signs short-lived segment URLs. Exactly two prefixes are
  anonymously readable, `thumbnails/*` and `subtitles/*`, because the apps load
  those unsigned. `minio-init` in `docker-compose.prod.yml` sets this on first
  start; the dev stack mirrors it.
- **Caddy persists certificates** in the `caddy_data` named volume — never
  delete that volume unless you want to re-issue from Let's Encrypt, which is
  rate-limited.
- **Storage and the app share one uplink.** If viewers start buffering, the
  first thing to check is upstream bandwidth, not the server's CPU.
