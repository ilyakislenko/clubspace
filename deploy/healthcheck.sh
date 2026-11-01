#!/usr/bin/env bash
# Health and alerts without paid services — run every 5 minutes by
# clubspace-healthcheck.timer (bootstrap.sh installs it), as root.
#
#   sudo ./deploy/healthcheck.sh               run all checks once
#   sudo ./deploy/healthcheck.sh --test-alert  send a test message and exit
#
# Checks:
#   api-healthz  https://api.<DOMAIN>/healthz answers (if not: is the server
#                container itself alive? — tells a proxy/DNS problem from a dead app)
#   api-readyz   /readyz is 200: database, Redis, SMTP (sign-in codes!) usable
#   containers   every service of the stack is running and not unhealthy
#   disk         /, Docker's data dir and BACKUP_DIR below ALERT_DISK_PERCENT (85)
#   backup-s3    last good backup-s3.sh younger than ALERT_BACKUP_MAX_AGE_HOURS (30)
#   backup-local no LAST_FAILURE / LAST_MEDIA_FAILURE marker from db-backup/media-backup
#   certs        TLS certificates of api/admin/app/s3 valid for ALERT_CERT_MIN_DAYS (14)
#
# Alerts go to Telegram and/or e-mail (deploy/lib/common.sh, notify). A failing
# check alerts once, repeats every ALERT_REPEAT_HOURS (6) while it stays
# failing, and sends «восстановлено» when it passes again — not a message every
# five minutes. State lives in $CLUBSPACE_STATE_DIR/health/.
set -Eeuo pipefail

CS_TAG=healthcheck
# shellcheck source=deploy/lib/common.sh
. "$(dirname "$0")/lib/common.sh"

load_env

if [ "${1:-}" = "--test-alert" ]; then
    notify "Тестовое уведомление" "Если вы это читаете — алерты ClubSpace доходят. $(hostname)"
    exit 0
fi

state_dir
HC_DIR="$CS_STATE_DIR/health"
mkdir -p "$HC_DIR"
REPEAT=$((${ALERT_REPEAT_HOURS:-6} * 3600))
NOW="$(date +%s)"
NEW=""
STILL=""
RECOVERED=""
FAILING=0

fmt_epoch() { date -d "@$1" '+%d.%m %H:%M' 2> /dev/null || date -r "$1" '+%d.%m %H:%M'; }

# record <check> <ok|fail> <message>
record() {
    local name="$1" status="$2" msg="$3" f="$HC_DIR/$1.fail" first last
    if [ "$status" = ok ]; then
        if [ -f "$f" ]; then
            RECOVERED="${RECOVERED}✓ $name: $msg"$'\n'
            rm -f "$f"
        fi
        return 0
    fi
    FAILING=$((FAILING + 1))
    log "FAIL $name: $msg"
    if [ ! -f "$f" ]; then
        NEW="${NEW}✗ $name: $msg"$'\n'
        printf '%s %s\n' "$NOW" "$NOW" > "$f"
        return 0
    fi
    read -r first last < "$f" || true
    first="${first:-$NOW}"
    last="${last:-0}"
    if [ $((NOW - last)) -ge "$REPEAT" ]; then
        STILL="${STILL}✗ $name (с $(fmt_epoch "$first")): $msg"$'\n'
        printf '%s %s\n' "$first" "$NOW" > "$f"
    fi
}

PUBLIC_PORT="${PUBLIC_PORT_SUFFIX#:}"
PUBLIC_PORT="${PUBLIC_PORT:-443}"
API_BASE="${HEALTH_API_URL:-https://api.$DOMAIN${PUBLIC_PORT_SUFFIX:-}}"

check_healthz() {
    local err inside
    if err="$(curl -fsS -m 15 -o /dev/null "$API_BASE/healthz" 2>&1)"; then
        record api-healthz ok "$API_BASE/healthz отвечает"
        return 0
    fi
    if compose exec -T server wget -qO- http://127.0.0.1:3000/healthz > /dev/null 2>&1; then
        inside="контейнер server жив — проблема в Caddy/DNS/сертификате/сети"
    else
        inside="контейнер server НЕ отвечает: docker compose logs server"
    fi
    record api-healthz fail "$API_BASE/healthz недоступен (${err:-нет ответа}); $inside"
}

check_readyz() {
    local body code
    body="$(curl -sS -m 20 -w '\n%{http_code}' "$API_BASE/readyz" 2>&1 || true)"
    code="$(printf '%s' "$body" | tail -n 1)"
    if [ "$code" = 200 ]; then
        record api-readyz ok "/readyz 200"
    else
        record api-readyz fail "/readyz $code: $(printf '%s' "$body" | sed '$d' | head -c 300)"
    fi
}

check_containers() {
    local ps expected bad="" svc line state health
    if ! ps="$(compose ps -a --format '{{.Service}}	{{.State}}	{{.Health}}	{{.ExitCode}}' 2>&1)"; then
        record containers fail "docker compose ps не работает: $ps"
        return 0
    fi
    expected="$(compose config --services 2> /dev/null || true)"
    for svc in $expected; do
        [ "$svc" = minio-init ] && continue
        line="$(printf '%s\n' "$ps" | awk -F'\t' -v s="$svc" '$1 == s' | head -n 1)"
        if [ -z "$line" ]; then
            bad="$bad $svc(не создан)"
            continue
        fi
        state="$(printf '%s' "$line" | cut -f2)"
        health="$(printf '%s' "$line" | cut -f3)"
        if [ "$state" != running ] || [ "$health" = unhealthy ]; then
            bad="$bad $svc($state${health:+/$health})"
        fi
    done
    line="$(printf '%s\n' "$ps" | awk -F'\t' '$1 == "minio-init" && $4 != "0"' | head -n 1)"
    [ -z "$line" ] || bad="$bad minio-init(exit $(printf '%s' "$line" | cut -f4))"
    if [ -n "$bad" ]; then
        record containers fail "сервисы не в порядке:$bad"
    else
        record containers ok "все сервисы работают"
    fi
}

check_disk() {
    local limit="${ALERT_DISK_PERCENT:-85}" paths p used bad="" seen=" "
    paths="/ $(docker info -f '{{.DockerRootDir}}' 2> /dev/null || true) ${BACKUP_DIR:-}"
    for p in $paths; do
        [ -d "$p" ] || continue
        case "$seen" in *" $p "*) continue ;; esac
        seen="$seen$p "
        used="$(df -P "$p" | awk 'NR == 2 { gsub("%", "", $5); print $5 }')"
        if [ -n "$used" ] && [ "$used" -ge "$limit" ]; then
            bad="$bad $p ${used}%"
        fi
    done
    if [ -n "$bad" ]; then
        record disk fail "диск заполнен (порог ${limit}%):$bad. Чистка: docker image prune -a, docker builder prune"
    else
        record disk ok "занятость дисков ниже ${limit}%"
    fi
}

check_backup_s3() {
    local max_h="${ALERT_BACKUP_MAX_AGE_HOURS:-30}" last age_h
    last="$(read_epoch "$CS_STATE_DIR/backup-s3.last-ok")"
    if [ "$last" = 0 ]; then
        record backup-s3 fail "ни одного успешного бэкапа в S3 (deploy/backup-s3.sh, journalctl -u clubspace-backup)"
        return 0
    fi
    age_h=$(((NOW - last) / 3600))
    if [ "$age_h" -ge "$max_h" ]; then
        record backup-s3 fail "последний успешный бэкап в S3 — $age_h ч назад ($(cat "$CS_STATE_DIR/backup-s3.last-key" 2> /dev/null || echo '?'))"
    else
        record backup-s3 ok "последний бэкап $age_h ч назад"
    fi
}

check_backup_local() {
    local dir="${BACKUP_DIR:-/var/backups/clubspace}" bad=""
    [ -f "$dir/LAST_FAILURE" ] && bad="$bad дамп базы (db-backup) не удаётся с $(cat "$dir/LAST_FAILURE");"
    [ -f "$dir/LAST_MEDIA_FAILURE" ] && bad="$bad зеркало видео (media-backup) не удаётся с $(cat "$dir/LAST_MEDIA_FAILURE");"
    if [ -n "$bad" ]; then
        bad="${bad# }"
        record backup-local fail "${bad%;} — docker compose logs db-backup media-backup"
    else
        record backup-local ok "локальные бэкапы без ошибок"
    fi
}

check_certs() {
    local min_days="${ALERT_CERT_MIN_DAYS:-14}" sub host pem end bad=""
    for sub in ${HEALTH_CERT_SUBDOMAINS:-api admin app s3}; do
        host="$sub.$DOMAIN"
        pem="$(openssl s_client -connect "$host:$PUBLIC_PORT" -servername "$host" < /dev/null 2> /dev/null \
            | openssl x509 2> /dev/null || true)"
        if [ -z "$pem" ]; then
            bad="$bad $host: сертификат не получен;"
            continue
        fi
        end="$(printf '%s\n' "$pem" | openssl x509 -noout -enddate | cut -d= -f2)"
        if ! printf '%s\n' "$pem" | openssl x509 -noout -checkend $((min_days * 86400)) > /dev/null; then
            bad="$bad $host: истекает $end;"
        fi
    done
    if [ -n "$bad" ]; then
        record certs fail "TLS (порог $min_days дн.):$bad Caddy продлевает сам — смотрите docker compose logs caddy"
    else
        record certs ok "сертификаты действительны дольше $min_days дн."
    fi
}

check_healthz
check_readyz
check_containers
check_disk
check_backup_s3
check_backup_local
[ "${HEALTH_SKIP_CERTS:-}" = 1 ] || check_certs

if [ -n "$NEW$STILL" ]; then
    notify "Проблемы на сервере ($FAILING)" "$NEW$STILL"
fi
if [ -n "$RECOVERED" ]; then
    notify "Восстановлено" "$RECOVERED"
fi
log "проверок с ошибкой: $FAILING"
[ "$FAILING" = 0 ]
