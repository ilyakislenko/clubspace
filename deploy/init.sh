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
FORCE=0; DRY_RUN=0; SKIP_DNS=0

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
  --force                  Overwrite an existing .env.production. Rotates all
                           secrets and signs everyone out. Rarely what you want.
  --skip-dns               Skip the DNS preflight. Only for a host that is not
                           yet reachable from outside.
  --dry-run                Print the env file that would be written and stop.
USAGE
}

while [ $# -gt 0 ]; do
    case "$1" in
        --domain) DOMAIN="${2:-}"; shift 2 ;;
        --admin-email) ADMIN_EMAIL="${2:-}"; shift 2 ;;
        --smtp-url) SMTP_URL="${2:-}"; shift 2 ;;
        --club-key) CLUB_KEY="${2:-}"; shift 2 ;;
        --acme-email) ACME_EMAIL="${2:-}"; shift 2 ;;
        --force) FORCE=1; shift ;;
        --skip-dns) SKIP_DNS=1; shift ;;
        --dry-run) DRY_RUN=1; SKIP_DNS=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) usage; fail "Unknown argument: $1" ;;
    esac
done

[ -n "$DOMAIN" ] || { usage; fail "--domain is required"; }
[ -n "$ADMIN_EMAIL" ] || { usage; fail "--admin-email is required"; }
[ -n "$SMTP_URL" ] || { usage; fail "--smtp-url is required"; }
ACME_EMAIL="${ACME_EMAIL:-$ADMIN_EMAIL}"

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
SMTP_NO_REPLY_EMAIL=noreply@$DOMAIN
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
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build

step "5/5  Жду готовности"
# /readyz names the dependency that is broken; a healthy process with dead SMTP
# looks fine everywhere else and locks everyone out, so this is the check that
# matters.
ready=""
for _ in $(seq 1 60); do
    body="$(curl -fsS --max-time 5 "https://api.$DOMAIN/readyz" 2>/dev/null || true)"
    case "$body" in
        *'"status":"ok"'*) ready="$body"; break ;;
    esac
    sleep 5
done

if [ -z "$ready" ]; then
    printf '\n\033[31m✗ Стек поднялся, но /readyz не отвечает ok\033[0m\n' >&2
    curl -s "https://api.$DOMAIN/readyz" >&2 || true
    printf '\n  Логи: docker compose -f docker-compose.prod.yml logs -f server\n' >&2
    exit 1
fi

cat <<DONE

  ┌─ Готово ─────────────────────────────────────────────────────┐
  │  Админка   https://admin.$DOMAIN
  │  Ученикам  https://app.$DOMAIN
  │  API       https://api.$DOMAIN   (/healthz · /readyz)
  └──────────────────────────────────────────────────────────────┘

  Дальше:
  1. Войди в админку под $ADMIN_EMAIL — код придёт на почту, пароля нет.
  2. В /platform создай клуб с ключом РОВНО: $CLUB_KEY
     Ключ должен совпасть с тем, что зашит в приложение, иначе ученики
     войдут в пустоту и не появятся в списке на одобрение.
  3. На машине с Node выполни:
     ./scripts/set-mobile-target.sh --domain $DOMAIN --club-key $CLUB_KEY
     затем: cd apps/mobile && npx eas build --profile production --platform android

DONE
