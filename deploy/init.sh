#!/usr/bin/env bash
# First-install bootstrap for a self-hosted ClubSpace.
#
# Generates every secret, writes .env.production, checks the things that make
# a first start fail silently, and brings the stack up.
#
#   ./deploy/init.sh --domain club.example.com \
#                    --admin-email you@example.com \
#                    --smtp-url 'smtps://user:pass@smtp.provider.com:465'
#
# Re-running is refused unless --force: the secrets it generates are what the
# existing database and its sessions were encrypted and signed with, so
# silently rotating them would lock every account out of a working install.
set -euo pipefail

cd "$(dirname "$0")/.."

DOMAIN=""; ADMIN_EMAIL=""; SMTP_URL=""; CLUB_KEY=""; ACME_EMAIL=""
FORCE=0; DRY_RUN=0; SKIP_DNS=0; MODE=""; PUBLIC_PORT=""; CADDY_HTTP_PORT=""; CADDY_HTTPS_PORT=""; SMTP_FROM=""

fail() { printf '\n\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }
step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$1"; }
note() { printf '  %s\n' "$1"; }

usage() {
    cat <<'USAGE'
Usage: ./deploy/init.sh --domain <domain> --admin-email <email> --smtp-url <url> [options]

Required:
  --domain <domain>        Bare domain. api./admin./app./s3. must already
                           resolve to this host.
  --admin-email <email>    Platform owner. Sign-in is an emailed code, so
                           whoever reads this mailbox controls the platform.
  --smtp-url <url>         e.g. smtps://user:pass@smtp.provider.com:465

Options:
  --club-key <key>         Key for your first club, [a-z0-9_-]{2,50}.
                           Default: derived from the domain's first label.
  --acme-email <email>     Let's Encrypt contact. Default: --admin-email.
  --smtp-from <email>      Envelope sender. Must be an address the relay is
                           allowed to send as — a consumer mailbox (Yandex,
                           Gmail, Mail.ru) rejects anything but its own, so the
                           noreply@<domain> default only works with a relay you
                           have verified the domain with.
  --public-port <port>     Serve on a non-standard HTTPS port, e.g. 8443, when
                           the ISP or the router blocks 443. It lands in every
                           public URL. Default: 443 (no port in URLs).
  --force                  Overwrite an existing .env.production. Rotates all
                           secrets and signs everyone out. Rarely what you want.
  --skip-dns               Skip the DNS preflight. Only for a host that is not
                           yet reachable from outside.
  --dry-run                Print the env file that would be written and stop.

Reverse proxy (auto-detected from whether 80/443 are already in use):
  --with-caddy             Run the bundled Caddy on 80/443. Needs them free.
  --behind-proxy           Join an existing proxy's network instead
                           (nginx-proxy-manager, Traefik, nginx). Override the
                           network name with PROXY_NETWORK, default shared-net.
  --caddy-ports <h>:<s>    Publish the bundled Caddy on these host ports instead
                           of 80:443, e.g. 8080:8443, and forward external
                           80 -> 8080 and 443 -> 8443 on the router. Use this
                           when another proxy owns 80/443 but you want only THIS
                           stack reachable from the internet — that proxy then
                           stays local, since the router never sends it traffic.
USAGE
}

while [ $# -gt 0 ]; do
    case "$1" in
        --domain) DOMAIN="${2:-}"; shift 2 ;;
        --admin-email) ADMIN_EMAIL="${2:-}"; shift 2 ;;
        --smtp-url) SMTP_URL="${2:-}"; shift 2 ;;
        --club-key) CLUB_KEY="${2:-}"; shift 2 ;;
        --acme-email) ACME_EMAIL="${2:-}"; shift 2 ;;
        --smtp-from) SMTP_FROM="${2:-}"; shift 2 ;;
        --public-port) PUBLIC_PORT="${2:-}"; shift 2 ;;
        --caddy-ports)
            CADDY_HTTP_PORT="${2%%:*}"; CADDY_HTTPS_PORT="${2##*:}"; MODE="caddy"; shift 2 ;;
        --force) FORCE=1; shift ;;
        --skip-dns) SKIP_DNS=1; shift ;;
        --with-caddy) MODE="caddy"; shift ;;
        --behind-proxy) MODE="proxy"; shift ;;
        --dry-run) DRY_RUN=1; SKIP_DNS=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) usage; fail "Unknown argument: $1" ;;
    esac
done

[ -n "$DOMAIN" ] || { usage; fail "--domain is required"; }
[ -n "$ADMIN_EMAIL" ] || { usage; fail "--admin-email is required"; }
[ -n "$SMTP_URL" ] || { usage; fail "--smtp-url is required"; }
ACME_EMAIL="${ACME_EMAIL:-$ADMIN_EMAIL}"
SMTP_FROM="${SMTP_FROM:-noreply@$DOMAIN}"

# Empty on 443 so URLs stay clean; ":8443" otherwise. It has to reach every
# public URL — tokens are validated against the issuer and uploads are signed
# for the storage origin, so a mismatch fails at runtime, not at startup.
PUBLIC_PORT_SUFFIX=""
if [ -n "$PUBLIC_PORT" ] && [ "$PUBLIC_PORT" != "443" ]; then
    printf '%s' "$PUBLIC_PORT" | grep -Eq '^[0-9]{2,5}$' || fail "--public-port must be a number, got: $PUBLIC_PORT"
    PUBLIC_PORT_SUFFIX=":$PUBLIC_PORT"
fi
PUBLIC_BASE="$DOMAIN$PUBLIC_PORT_SUFFIX"

for _p in "$CADDY_HTTP_PORT" "$CADDY_HTTPS_PORT"; do
    [ -z "$_p" ] && continue
    printf '%s' "$_p" | grep -Eq '^[0-9]{2,5}$' || fail "--caddy-ports takes <http>:<https>, got: $_p"
done

if [ -z "$CLUB_KEY" ]; then
    CLUB_KEY="$(printf '%s' "$DOMAIN" | cut -d. -f1 | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9_-' '_' | cut -c1-50)"
fi
# Same shape the server enforces on Workspace.key — a key the app sends but the
# database has no row for attaches the student to nothing, silently.
printf '%s' "$CLUB_KEY" | grep -Eq '^[a-z0-9_-]{2,50}$' \
    || fail "--club-key must match [a-z0-9_-]{2,50}, got: $CLUB_KEY"

step "1/5  Проверяю инструменты"
command -v openssl >/dev/null 2>&1 || fail "openssl не найден"
if [ "$DRY_RUN" -eq 0 ]; then
    command -v docker >/dev/null 2>&1 || fail "Docker не найден. curl -fsSL https://get.docker.com | sh"
    docker compose version >/dev/null 2>&1 || fail "Плагин docker compose v2 не найден"
    docker info >/dev/null 2>&1 || fail "Docker daemon не отвечает"
fi
note "ok"

# 80/443 already bound means another reverse proxy owns them — Caddy would fail
# to start and, worse, take the rest of the stack's bring-up down with it.
if [ -z "$MODE" ]; then
    if [ "$DRY_RUN" -eq 1 ]; then
        MODE="caddy"
    elif ss -tulpn 2>/dev/null | grep -qE ":(${CADDY_HTTP_PORT:-80}|${CADDY_HTTPS_PORT:-443}) "; then
        MODE="proxy"
        note "порты 80/443 заняты — режим: за существующим прокси"
    else
        MODE="caddy"
        note "порты 80/443 свободны — режим: встроенный Caddy"
    fi
fi

if [ "$MODE" = "proxy" ]; then
    COMPOSE_ARGS="-f docker-compose.prod.yml -f docker-compose.proxy.yml"
    PROXY_NET="${PROXY_NETWORK:-shared-net}"
    if [ "$DRY_RUN" -eq 0 ] && ! docker network inspect "$PROXY_NET" >/dev/null 2>&1; then
        fail "Сеть '$PROXY_NET' не найдена. Это сеть твоего reverse-proxy — задай её через PROXY_NETWORK=имя."
    fi
else
    COMPOSE_ARGS="-f docker-compose.prod.yml --profile caddy"
fi

step "2/5  Проверяю DNS"
if [ "$SKIP_DNS" -eq 1 ]; then
    note "пропущено"
else
    PUBLIC_IP="$(curl -fsS --max-time 10 https://api.ipify.org || true)"
    [ -n "$PUBLIC_IP" ] || fail "Не удалось узнать внешний IP — проверь интернет на хосте"
    note "внешний IP: $PUBLIC_IP"
    for sub in api admin app s3; do
        host="$sub.$DOMAIN"
        resolved="$(getent hosts "$host" | awk '{print $1}' | head -1 || true)"
        [ -n "$resolved" ] || fail "$host не резолвится. Создай A-запись → $PUBLIC_IP и подожди пропагации."
        if [ "$resolved" != "$PUBLIC_IP" ]; then
            fail "$host резолвится в $resolved, а хост имеет $PUBLIC_IP. Caddy не получит сертификат — исправь запись."
        fi
        note "$host → $resolved"
    done
fi

step "3/5  Готовлю .env.production"
if [ -f .env.production ] && [ "$FORCE" -eq 0 ] && [ "$DRY_RUN" -eq 0 ]; then
    fail ".env.production уже существует. Его секреты — те, которыми подписаны текущие сессии и зашифрованы данные. Перезапись через --force разлогинит всех."
fi

JWT_SECRET="$(openssl rand -hex 64)"
PLAYBACK_TOKEN_SECRET="$(openssl rand -hex 64)"
ENCRYPTION_SECRET="$(openssl rand -hex 32)"
POSTGRES_PASSWORD="$(openssl rand -hex 24)"
REDIS_PASSWORD="$(openssl rand -hex 24)"
S3_ACCESS_KEY_ID="$(openssl rand -hex 16)"
S3_SECRET_ACCESS_KEY="$(openssl rand -hex 32)"

ENV_BODY="$(cat <<ENVFILE
# Written by deploy/init.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ). Do not commit.
# Hostnames, CORS and the S3 endpoint are derived from DOMAIN in
# docker-compose.prod.yml — setting them here has no effect.
NODE_ENV=production
PRODUCTION=1
SERVER_PORT=3000

DOMAIN=$DOMAIN
ACME_EMAIL=$ACME_EMAIL
PUBLIC_PORT_SUFFIX=$PUBLIC_PORT_SUFFIX
CADDY_HTTP_PORT=${CADDY_HTTP_PORT:-80}
CADDY_HTTPS_PORT=${CADDY_HTTPS_PORT:-443}

POSTGRES_USER=postgres
POSTGRES_DB=clubspace
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
REDIS_PASSWORD=$REDIS_PASSWORD
REDIS_DB=0

JWT_ACCESS_TOKEN_TTL=900
JWT_REFRESH_TOKEN_TTL=2592000
JWT_SECRET=$JWT_SECRET
PLAYBACK_TOKEN_SECRET=$PLAYBACK_TOKEN_SECRET
ENCRYPTION_SECRET=$ENCRYPTION_SECRET

SUPER_ADMIN_EMAIL=$ADMIN_EMAIL
SMTP_URL=$SMTP_URL
SMTP_NO_REPLY_EMAIL=$SMTP_FROM
COMPLETE_CODE_TIMEOUT=60000

S3_ACCESS_KEY_ID=$S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY=$S3_SECRET_ACCESS_KEY
S3_BUCKET_NAME=clubspace
S3_ACL=private

SENTRY_DSN=
SENTRY_ENVIRONMENT=production
ENVFILE
)"

if [ "$DRY_RUN" -eq 1 ]; then
    printf '%s\n' "$ENV_BODY"
    step "dry-run: ничего не записано, стек не поднимался"
    exit 0
fi

printf '%s\n' "$ENV_BODY" > .env.production
chmod 600 .env.production
note "записан .env.production (chmod 600)"

step "4/5  Собираю и поднимаю стек"
# COMPOSE_ARGS is a deliberate multi-word argument list, not one word.
# shellcheck disable=SC2086
docker compose $COMPOSE_ARGS --env-file .env.production up -d --build

step "5/5  Жду готовности"

if [ "$MODE" = "proxy" ]; then
    # The public URL cannot answer yet — the reverse proxy has no route to this
    # stack until the operator adds it. Wait on the container instead.
    ready=""
    for _ in $(seq 1 60); do
        # shellcheck disable=SC2086
        if docker compose $COMPOSE_ARGS --env-file .env.production exec -T server \
             wget -qO- http://127.0.0.1:3000/readyz 2>/dev/null | grep -q '"status":"ok"'; then
            ready="yes"; break
        fi
        sleep 5
    done

    if [ -z "$ready" ]; then
        printf '\n\033[31m✗ Стек поднялся, но /readyz внутри контейнера не отвечает ok\033[0m\n' >&2
        # shellcheck disable=SC2086
        docker compose $COMPOSE_ARGS --env-file .env.production exec -T server \
            wget -qO- http://127.0.0.1:3000/readyz >&2 2>/dev/null || true
        printf '\n  Логи: docker compose %s logs -f server\n' "$COMPOSE_ARGS" >&2
        exit 1
    fi

    cat <<DONE

  ┌─ Стек поднят. Осталось прописать его в твоём reverse-proxy ───┐
  │  api.$DOMAIN$PUBLIC_PORT_SUFFIX     ->  http://clubspace-api:3000
  │  admin.$DOMAIN$PUBLIC_PORT_SUFFIX   ->  http://clubspace-admin:3000
  │  app.$DOMAIN$PUBLIC_PORT_SUFFIX     ->  http://clubspace-app:3000
  │  s3.$DOMAIN$PUBLIC_PORT_SUFFIX      ->  http://clubspace-s3:9000
  └──────────────────────────────────────────────────────────────┘

  Для хоста s3.* обязательно сними лимит на размер загрузки,
  иначе большие видео будут обрываться. В nginx / NPM (Advanced):

      client_max_body_size 0;
      proxy_request_buffering off;

  Затем проверь снаружи:
      curl -s https://api.$PUBLIC_BASE/readyz

  Дальше:
  1. Войди в админку https://admin.$PUBLIC_BASE под $ADMIN_EMAIL — код придёт на почту.
  2. В /platform создай клуб с ключом РОВНО: $CLUB_KEY
  3. На машине с Node:
     ./scripts/set-mobile-target.sh --domain $DOMAIN --club-key $CLUB_KEY${PUBLIC_PORT_SUFFIX:+ --public-port $PUBLIC_PORT}
     затем: cd apps/mobile && npx eas build --profile production --platform android

DONE
    exit 0
fi

# Ask the container, not the public URL: a router that does not hairpin makes
# the public name unreachable from this very host while the internet reaches it
# fine, and that has nothing to do with whether the app is usable.
ready=""
for _ in $(seq 1 60); do
    # shellcheck disable=SC2086
    if docker compose $COMPOSE_ARGS --env-file .env.production exec -T server \
         wget -qO- http://127.0.0.1:3000/readyz 2>/dev/null | grep -q '"status":"ok"'; then
        ready="yes"; break
    fi
    sleep 5
done

if [ -z "$ready" ]; then
    printf '\n\033[31m✗ Стек поднялся, но /readyz не отвечает ok\033[0m\n' >&2
    # shellcheck disable=SC2086
    docker compose $COMPOSE_ARGS --env-file .env.production exec -T server \
        wget -qO- http://127.0.0.1:3000/readyz >&2 2>/dev/null || true
    printf '\n  Логи: docker compose %s logs -f server\n' "$COMPOSE_ARGS" >&2
    exit 1
fi

cat <<DONE

  ┌─ Стек поднят ────────────────────────────────────────────────┐
  │  Админка   https://admin.$PUBLIC_BASE
  │  Ученикам  https://app.$PUBLIC_BASE
  │  API       https://api.$PUBLIC_BASE   (/healthz · /readyz)
  └──────────────────────────────────────────────────────────────┘

  Caddy слушает на хосте $CADDY_HTTP_PORT (http) и $CADDY_HTTPS_PORT (https).
  Если это не 80/443 — на роутере должны быть пробросы
  80 -> $CADDY_HTTP_PORT и 443 -> $CADDY_HTTPS_PORT, иначе снаружи не откроется.

  Проверь снаружи (не с этой машины — роутер может не заворачивать трафик сам
  на себя): curl -s https://api.$PUBLIC_BASE/readyz

  Дальше:
  1. Войди в админку под $ADMIN_EMAIL — код придёт на почту, пароля нет.
  2. В /platform создай клуб с ключом РОВНО: $CLUB_KEY
     Ключ должен совпасть с тем, что зашит в приложение, иначе ученики
     войдут в пустоту и не появятся в списке на одобрение.
  3. На машине с Node выполни:
     ./scripts/set-mobile-target.sh --domain $DOMAIN --club-key $CLUB_KEY${PUBLIC_PORT_SUFFIX:+ --public-port $PUBLIC_PORT}
     затем: cd apps/mobile && npx eas build --profile production --platform android

DONE
