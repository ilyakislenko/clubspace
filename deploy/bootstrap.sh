#!/usr/bin/env bash
# One-command setup of a fresh Ubuntu VDS (22.04 / 24.04) for ClubSpace.
# Idempotent: re-running it repairs what is missing and changes nothing else.
#
#   curl -fsSL https://raw.githubusercontent.com/ilyakislenko/clubspace/main/deploy/bootstrap.sh \
#     | sudo bash -s -- --domain club.example.ru --admin-email you@example.ru \
#                       --smtp-url 'smtps://login:password@smtp.example.ru:465'
#   (or, from a checkout: sudo ./deploy/bootstrap.sh --domain …)
#
# What it does, each step skipped when already done:
#   1. packages; Docker Engine + compose plugin (get.docker.com, falling back
#      to Ubuntu's docker.io / docker-compose-v2)
#   2. deploy user (default `clubspace`, in the docker group, root's SSH keys)
#   3. firewall: ufw allows only SSH (the port sshd really listens on), 80, 443
#   4. fail2ban for sshd; unattended security upgrades
#   5. swap file when RAM < 16 GB (image builds need it on an 8 GB box)
#   6. clones the repo to --dir (default /opt/clubspace), or fast-forwards it
#      while the stack is not running yet (afterwards: deploy/update.sh)
#   7. .env.production from .env.production.example: missing keys are added,
#      REPLACE_WITH… placeholders get strong random secrets, --domain /
#      --admin-email / --smtp-url fill their placeholders. An existing value is
#      NEVER changed — those secrets sign live sessions and encrypt data.
#   8. DNS preflight (api/admin/app/s3.<domain> -> this server), then pulls
#      and builds images and starts docker-compose.prod.yml with the bundled
#      Caddy (automatic HTTPS for all four names from the one DOMAIN)
#   9. systemd timers: nightly encrypted backup to S3, healthcheck every 5 min
#      with Telegram/e-mail alerts, monthly restore check; a first backup
#
#   ./deploy/bootstrap.sh --env-only   step 7 only (no root needed): complete
#                                      .env.production after an update added keys
set -Eeuo pipefail
# The whole script is one { … } block: bash parses it completely before
# running it, so the `git pull` below may replace this file safely.
{

DOMAIN_ARG=""
ADMIN_EMAIL=""
SMTP_URL_ARG=""
SMTP_FROM=""
ACME_EMAIL_ARG=""
REPO_URL="${REPO_URL:-https://github.com/ilyakislenko/clubspace.git}"
BRANCH="${BRANCH:-main}"
INSTALL_DIR="${INSTALL_DIR:-}"
DEPLOY_USER="${DEPLOY_USER:-clubspace}"
SSH_PORT="${SSH_PORT:-}"
SWAP_SIZE="${SWAP_SIZE:-4G}"
REGISTRY_MIRROR="${REGISTRY_MIRROR:-}"
SKIP_DNS=0
ENV_ONLY=0
NO_START=0

say() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*" >&2; }
die() {
    printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2
    exit 1
}

usage() { sed -n '2,31p' "$0" 2> /dev/null | sed 's|^# \{0,1\}||'; cat <<'USAGE'

Options:
  --domain <domain>        bare domain; api./admin./app./s3. must point here
  --admin-email <email>    platform owner (SUPER_ADMIN_EMAIL): sign-in codes go here
  --smtp-url <url>         relay for sign-in codes, smtps://login:pass@host:465
  --smtp-from <email>      sender address (default noreply@<domain>)
  --acme-email <email>     Let's Encrypt contact (default --admin-email)
  --dir <path>             checkout location (default /opt/clubspace, or this
                           checkout when the script is run from one)
  --repo <url> --branch <name>
  --user <name>            deploy user (default clubspace)
  --ssh-port <port>        SSH port to keep open (default: what sshd listens on)
  --swap <size>            swap file size (default 4G)
  --registry-mirror <url>  Docker Hub mirror, when pulls from Docker Hub fail
  --skip-dns               skip the DNS preflight
  --no-start               prepare everything, do not start the stack
  --env-only               only create/complete .env.production
USAGE
}

while [ $# -gt 0 ]; do
    case "$1" in
        --domain) DOMAIN_ARG="${2:?}"; shift 2 ;;
        --admin-email) ADMIN_EMAIL="${2:?}"; shift 2 ;;
        --smtp-url) SMTP_URL_ARG="${2:?}"; shift 2 ;;
        --smtp-from) SMTP_FROM="${2:?}"; shift 2 ;;
        --acme-email) ACME_EMAIL_ARG="${2:?}"; shift 2 ;;
        --dir) INSTALL_DIR="${2:?}"; shift 2 ;;
        --repo) REPO_URL="${2:?}"; shift 2 ;;
        --branch) BRANCH="${2:?}"; shift 2 ;;
        --user) DEPLOY_USER="${2:?}"; shift 2 ;;
        --ssh-port) SSH_PORT="${2:?}"; shift 2 ;;
        --swap) SWAP_SIZE="${2:?}"; shift 2 ;;
        --registry-mirror) REGISTRY_MIRROR="${2:?}"; shift 2 ;;
        --skip-dns) SKIP_DNS=1; shift ;;
        --no-start) NO_START=1; shift ;;
        --env-only) ENV_ONLY=1; shift ;;
        -h | --help) usage; exit 0 ;;
        *) usage; die "неизвестный параметр: $1" ;;
    esac
done

# Run from a checkout -> that checkout is the install, unless --dir says otherwise.
SELF_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
    SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi
if [ -z "$INSTALL_DIR" ]; then
    if [ -n "$SELF_DIR" ] && [ -d "$SELF_DIR/.git" ]; then INSTALL_DIR="$SELF_DIR"; else INSTALL_DIR=/opt/clubspace; fi
fi

# ── .env.production ──────────────────────────────────────────────────────────

is_placeholder() {
    case "${1:-}" in '' | REPLACE_WITH* | *example.com* | *example.ru*) return 0 ;; esac
    return 1
}

# Strength follows the template's own hint in the placeholder.
gen_secret() {
    case "$1" in
        *64_BYTE*) openssl rand -hex 64 ;;
        *32_BYTE*) openssl rand -hex 32 ;;
        *STRONG_PASSWORD*) openssl rand -hex 24 ;;
        *RANDOM_KEY*) openssl rand -hex 16 ;;
        *) openssl rand -hex 32 ;;
    esac
}

env_get() { # env_get <file> <key> -> value of the last uncommented KEY= line
    awk -v k="$2" 'index($0, k "=") == 1 { v = substr($0, length(k) + 2) } END { print v }' "$1"
}

env_has() { grep -q "^$2=" "$1"; }

env_set() { # env_set <file> <key> <value>: replace the KEY= line, or append it
    local tmp line done=0
    tmp="$(mktemp "$(dirname "$1")/.env.XXXXXX")"
    while IFS= read -r line || [ -n "$line" ]; do
        if [ "$done" = 0 ] && [ "${line%%=*}" = "$2" ] && [ "${line#*=}" != "$line" ]; then
            printf '%s=%s\n' "$2" "$3"
            done=1
        else
            printf '%s\n' "$line"
        fi
    done < "$1" > "$tmp"
    [ "$done" = 1 ] || printf '%s=%s\n' "$2" "$3" >> "$tmp"
    # Rewrite in place: keeps the file's owner and mode when root edits the
    # deploy user's file (update.sh runs this with sudo).
    cat "$tmp" > "$1"
    rm -f "$tmp"
}

env_fill() {
    local example="$INSTALL_DIR/.env.production.example" env="$INSTALL_DIR/.env.production"
    local key val cur added=0 generated=0 line domain admin
    [ -f "$example" ] || die "нет $example"
    if [ ! -f "$env" ]; then
        (umask 077 && printf '# Created by deploy/bootstrap.sh on %s from .env.production.example. Do not commit.\n' \
            "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$env")
        note "создан $env"
    fi
    chmod 600 "$env"

    # Every key the template has: added when missing (new settings after an
    # update), a secret generated in place of a placeholder. Existing values
    # are left exactly as they are.
    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in '' | '#'* | *' '*=*) continue ;; esac
        case "$line" in *=*) ;; *) continue ;; esac
        key="${line%%=*}"
        val="${line#*=}"
        [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
        if ! env_has "$env" "$key"; then
            case "$val" in REPLACE_WITH*) val="$(gen_secret "$val")"; generated=$((generated + 1)) ;; esac
            env_set "$env" "$key" "$val"
            added=$((added + 1))
        else
            cur="$(env_get "$env" "$key")"
            case "$cur" in
                REPLACE_WITH*)
                    env_set "$env" "$key" "$(gen_secret "$cur")"
                    generated=$((generated + 1))
                    ;;
            esac
        fi
    done < "$example"

    # Inputs fill placeholders only.
    fill() { # fill <key> <value>
        [ -n "$2" ] || return 0
        cur="$(env_get "$env" "$1")"
        if is_placeholder "$cur"; then
            env_set "$env" "$1" "$2"
        elif [ "$cur" != "$2" ]; then
            warn "$1 в .env.production уже задан ($cur) — оставляю как есть"
        fi
    }
    fill DOMAIN "$DOMAIN_ARG"
    domain="$(env_get "$env" DOMAIN)"
    fill SUPER_ADMIN_EMAIL "$ADMIN_EMAIL"
    admin="$(env_get "$env" SUPER_ADMIN_EMAIL)"
    is_placeholder "$admin" && admin=""
    fill ACME_EMAIL "${ACME_EMAIL_ARG:-$admin}"
    fill SMTP_URL "$SMTP_URL_ARG"
    if ! is_placeholder "$domain"; then fill SMTP_NO_REPLY_EMAIL "${SMTP_FROM:-noreply@$domain}"; fi
    [ -n "$(env_get "$env" SUPPORT_EMAIL)" ] || fill SUPPORT_EMAIL "$admin"
    # The bundled Caddy is part of a VDS install; manual `docker compose
    # --env-file .env.production …` commands then include it too.
    env_has "$env" COMPOSE_PROFILES || env_has "$env" COMPOSE_FILE || env_set "$env" COMPOSE_PROFILES caddy

    note ".env.production: добавлено ключей $added, сгенерировано секретов $generated (существующие значения не тронуты)"
}

env_missing_inputs() {
    local env="$INSTALL_DIR/.env.production" k missing=""
    for k in DOMAIN ACME_EMAIL SUPER_ADMIN_EMAIL SMTP_URL SMTP_NO_REPLY_EMAIL; do
        is_placeholder "$(env_get "$env" "$k")" && missing="$missing $k"
    done
    printf '%s' "$missing"
}

if [ "$ENV_ONLY" = 1 ]; then
    command -v openssl > /dev/null || die "нужен openssl"
    env_fill
    m="$(env_missing_inputs)"
    [ -z "$m" ] || warn "ещё не заданы:$m (параметры --domain/--admin-email/--smtp-url или правка .env.production)"
    exit 0
fi

# ── Host ─────────────────────────────────────────────────────────────────────

[ "$(id -u)" = 0 ] || die "запустите от root: sudo $0 …"
command -v apt-get > /dev/null || die "нужен Ubuntu/Debian (apt-get)"
export DEBIAN_FRONTEND=noninteractive

say "1/9  Пакеты и Docker"
apt-get update -qq
apt-get install -y -qq ca-certificates curl git openssl ufw fail2ban python3-systemd unattended-upgrades > /dev/null
if ! docker compose version > /dev/null 2>&1; then
    if curl -fsSL https://get.docker.com -o /tmp/get-docker.sh && sh /tmp/get-docker.sh > /dev/null; then
        note "Docker установлен с get.docker.com"
    else
        warn "get.docker.com недоступен — ставлю Docker из репозитория Ubuntu"
        apt-get install -y -qq docker.io docker-compose-v2 docker-buildx > /dev/null
    fi
    rm -f /tmp/get-docker.sh
fi
docker compose version > /dev/null 2>&1 || die "docker compose не установился"
if [ -n "$REGISTRY_MIRROR" ]; then
    if [ ! -f /etc/docker/daemon.json ]; then
        mkdir -p /etc/docker
        printf '{\n  "registry-mirrors": ["%s"]\n}\n' "$REGISTRY_MIRROR" > /etc/docker/daemon.json
        systemctl restart docker
        note "зеркало Docker Hub: $REGISTRY_MIRROR"
    elif ! grep -q "$REGISTRY_MIRROR" /etc/docker/daemon.json; then
        warn "/etc/docker/daemon.json уже есть — добавьте \"registry-mirrors\": [\"$REGISTRY_MIRROR\"] вручную"
    fi
fi
systemctl enable --now docker > /dev/null 2>&1
note "$(docker --version), $(docker compose version --short 2> /dev/null || true)"

say "2/9  Пользователь $DEPLOY_USER"
if ! id -u "$DEPLOY_USER" > /dev/null 2>&1; then
    useradd -m -s /bin/bash "$DEPLOY_USER"
    note "создан"
fi
usermod -aG docker "$DEPLOY_USER"
DEPLOY_HOME="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
if [ -s /root/.ssh/authorized_keys ] && [ ! -s "$DEPLOY_HOME/.ssh/authorized_keys" ]; then
    install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_HOME/.ssh"
    install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /root/.ssh/authorized_keys "$DEPLOY_HOME/.ssh/authorized_keys"
    note "SSH-ключи root скопированы: ssh $DEPLOY_USER@<ip>"
fi

say "3/9  Firewall (ufw)"
if [ -z "$SSH_PORT" ]; then
    SSH_PORT="$(sshd -T 2> /dev/null | awk '$1 == "port" { print $2; exit }' || true)"
    SSH_PORT="${SSH_PORT:-22}"
fi
ufw default deny incoming > /dev/null
ufw default allow outgoing > /dev/null
ufw allow "$SSH_PORT/tcp" > /dev/null
ufw allow 80/tcp > /dev/null
ufw allow 443/tcp > /dev/null
ufw allow 443/udp > /dev/null # HTTP/3, same port
ufw --force enable > /dev/null
note "открыты: $SSH_PORT/tcp (SSH), 80/tcp, 443/tcp+udp"
# Docker publishes ports past ufw's INPUT chain. Only Caddy publishes any
# (80/443); Postgres, Redis and MinIO are never published (see compose file).

say "4/9  fail2ban и автоматические обновления безопасности"
JAIL=/etc/fail2ban/jail.d/clubspace.local
JAIL_BODY="[sshd]
enabled = true
port = $SSH_PORT
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h"
if [ "$(cat "$JAIL" 2> /dev/null || true)" != "$JAIL_BODY" ]; then
    printf '%s\n' "$JAIL_BODY" > "$JAIL"
    systemctl enable fail2ban > /dev/null 2>&1
    systemctl restart fail2ban
fi
note "fail2ban: sshd, 5 попыток -> бан на час"
# Ubuntu's 50unattended-upgrades already limits itself to the security pocket;
# this only switches the daily run on. Reboots stay manual (kernel updates:
# `sudo reboot` in a quiet hour when /var/run/reboot-required exists).
printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' > /etc/apt/apt.conf.d/20auto-upgrades
systemctl enable --now unattended-upgrades > /dev/null 2>&1 || true
note "unattended-upgrades: ежедневно, только security"

say "5/9  Swap"
MEM_KB="$(awk '/^MemTotal:/ { print $2 }' /proc/meminfo)"
if [ "$MEM_KB" -ge $((16 * 1024 * 1024)) ]; then
    note "RAM $((MEM_KB / 1024 / 1024)) ГБ — swap не нужен"
elif [ -n "$(swapon --show --noheadings 2> /dev/null)" ]; then
    note "swap уже есть: $(swapon --show --noheadings | awk '{ print $1, $3 }' | tr '\n' ' ')"
else
    fallocate -l "$SWAP_SIZE" /swapfile 2> /dev/null || dd if=/dev/zero of=/swapfile bs=1M count="$(numfmt --from=iec "$SWAP_SIZE" | awk '{ print int($1 / 1048576) }')" status=none
    chmod 600 /swapfile
    mkswap /swapfile > /dev/null
    swapon /swapfile
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    note "swap $SWAP_SIZE включён (/swapfile)"
fi
printf 'vm.swappiness = 10\n' > /etc/sysctl.d/99-clubspace.conf
sysctl -q -p /etc/sysctl.d/99-clubspace.conf

say "6/9  Код: $INSTALL_DIR"
as_user() { sudo -u "$DEPLOY_USER" -H "$@"; }
if [ -d "$INSTALL_DIR/.git" ]; then
    chown -R "$DEPLOY_USER:$DEPLOY_USER" "$INSTALL_DIR"
    if [ -n "$(docker ps -q --filter label=com.docker.compose.project=clubspace --filter label=com.docker.compose.service=server)" ]; then
        note "стек уже работает — код не обновляю (для обновления: sudo $INSTALL_DIR/deploy/update.sh)"
    else
        as_user git -C "$INSTALL_DIR" pull -q --ff-only || warn "git pull не удался — продолжаю с текущим кодом"
        note "$(as_user git -C "$INSTALL_DIR" log -1 --format='%h %s')"
    fi
else
    install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$INSTALL_DIR"
    if ! as_user git clone -q --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"; then
        # A private fork: give the server a read-only deploy key.
        if [ ! -f "$DEPLOY_HOME/.ssh/id_ed25519" ]; then
            install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_HOME/.ssh"
            as_user ssh-keygen -q -t ed25519 -N '' -C "clubspace-deploy@$(hostname)" -f "$DEPLOY_HOME/.ssh/id_ed25519"
            as_user sh -c "ssh-keyscan -q github.com >> '$DEPLOY_HOME/.ssh/known_hosts' 2> /dev/null" || true
        fi
        die "не удалось склонировать $REPO_URL. Для приватного репозитория добавьте этот ключ в GitHub → Settings → Deploy keys (read-only):
$(cat "$DEPLOY_HOME/.ssh/id_ed25519.pub")
и запустите снова с --repo git@github.com:<owner>/<repo>.git"
    fi
    note "$(as_user git -C "$INSTALL_DIR" log -1 --format='%h %s')"
fi
# Root runs update.sh on a checkout owned by the deploy user.
git config --system --get-all safe.directory 2> /dev/null | grep -qx "$INSTALL_DIR" \
    || git config --system --add safe.directory "$INSTALL_DIR"

say "7/9  .env.production"
env_fill
chown "$DEPLOY_USER:$DEPLOY_USER" "$INSTALL_DIR/.env.production"
MISSING="$(env_missing_inputs)"
[ -z "$MISSING" ] || die "не заданы:$MISSING. Передайте --domain, --admin-email, --smtp-url (или впишите в $INSTALL_DIR/.env.production) и запустите снова"

# The ops scripts share helpers from here on.
# shellcheck source=deploy/lib/common.sh
. "$INSTALL_DIR/deploy/lib/common.sh"
load_env
install -d -m 700 "$CS_STATE_DIR"
install -d -m 700 "${BACKUP_DIR:-/var/backups/clubspace}"

say "8/9  DNS и запуск"
if [ "$SKIP_DNS" = 1 ]; then
    note "проверка DNS пропущена"
else
    PUBLIC_IP="$(curl -4 -fsS --max-time 10 https://api.ipify.org || curl -4 -fsS --max-time 10 https://ifconfig.me || true)"
    [ -n "$PUBLIC_IP" ] || die "не удалось узнать внешний IP"
    for sub in api admin app s3; do
        host="$sub.$DOMAIN"
        resolved="$(getent ahostsv4 "$host" | awk 'NR == 1 { print $1 }' || true)"
        [ -n "$resolved" ] || die "$host не резолвится. Создайте A-запись $host → $PUBLIC_IP и подождите (обычно 5–30 мин)"
        [ "$resolved" = "$PUBLIC_IP" ] || die "$host → $resolved, а у сервера $PUBLIC_IP. Caddy не получит сертификат — исправьте запись"
        note "$host → $resolved"
    done
fi

if [ "$NO_START" = 1 ]; then
    note "--no-start: стек не запускаю"
else
    compose pull --ignore-buildable --quiet
    # One image at a time: two Next.js builds side by side do not fit in 8 GB.
    for svc in server video-worker admin client; do
        note "сборка $svc (первый раз — несколько минут)…"
        compose build -q "$svc"
    done
    compose up -d --no-build
    ready=""
    for _ in $(seq 1 60); do
        if compose exec -T server wget -qO- http://127.0.0.1:3000/readyz 2> /dev/null | grep -q '"status":"ok"'; then
            ready=yes
            break
        fi
        sleep 5
    done
    if [ -z "$ready" ]; then
        compose exec -T server wget -qO- http://127.0.0.1:3000/readyz >&2 2> /dev/null || true
        die "стек запущен, но /readyz не ok. Логи: cd $INSTALL_DIR && docker compose --env-file .env.production -f docker-compose.prod.yml logs server"
    fi
    note "/readyz: ok"
fi

say "9/9  Таймеры: бэкап, мониторинг, проверка восстановления"
for unit in "$INSTALL_DIR"/deploy/systemd/*.service "$INSTALL_DIR"/deploy/systemd/*.timer; do
    dst="/etc/systemd/system/$(basename "$unit")"
    sed -e "s|@INSTALL_DIR@|$INSTALL_DIR|g" "$unit" > "$dst.new"
    if cmp -s "$dst.new" "$dst"; then rm -f "$dst.new"; else mv -f "$dst.new" "$dst"; fi
done
systemctl daemon-reload
for t in clubspace-backup clubspace-healthcheck clubspace-restore-check; do
    systemctl enable --now "$t.timer" > /dev/null 2>&1
done
note "$(systemctl list-timers 'clubspace-*' --no-pager --no-legend | awk '{ print $NF }' | tr '\n' ' ')"

if [ "$NO_START" = 0 ] && [ ! -f "$CS_STATE_DIR/backup-s3.last-ok" ]; then
    "$INSTALL_DIR/deploy/backup-s3.sh" || warn "первый бэкап не удался — задайте BACKUP_S3_* в .env.production и: sudo $INSTALL_DIR/deploy/backup-s3.sh"
fi
if [ -n "${ALERT_TELEGRAM_BOT_TOKEN:-}${ALERT_EMAIL:-}" ]; then
    "$INSTALL_DIR/deploy/healthcheck.sh" --test-alert || true
else
    warn "алерты не настроены: задайте ALERT_TELEGRAM_BOT_TOKEN + ALERT_TELEGRAM_CHAT_ID и/или ALERT_EMAIL в .env.production"
fi
[ -n "${BACKUP_S3_ENDPOINT:-}" ] || warn "BACKUP_S3_ENDPOINT пуст — бэкапы лежат на этом же сервере. Задайте внешний S3 (deploy/README.md)"

BASE="$DOMAIN${PUBLIC_PORT_SUFFIX:-}"
cat <<DONE

  ┌─ Готово ─────────────────────────────────────────────────────┐
  │  Админка   https://admin.$BASE
  │  Ученикам  https://app.$BASE
  │  API       https://api.$BASE/healthz
  └──────────────────────────────────────────────────────────────┘

  1. Войдите в админку под $SUPER_ADMIN_EMAIL — код придёт на почту.
  2. В /platform создайте клуб (или включите SELF_SERVE_SIGNUP_ENABLED).
  3. Секреты — в менеджер паролей, НЕ на этом сервере:
       sudo cat $INSTALL_DIR/.env.production
     Без BACKUP_ENCRYPTION_KEY бэкап не расшифровать никому, включая вас.
  4. Обновление:    sudo $INSTALL_DIR/deploy/update.sh
     Проверка:      sudo $INSTALL_DIR/deploy/healthcheck.sh
     Бэкапы:        sudo $INSTALL_DIR/deploy/restore.sh --list

DONE
exit 0
}
