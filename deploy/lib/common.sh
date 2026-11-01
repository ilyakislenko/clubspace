# shellcheck shell=bash
# Shared helpers for the host-side ops scripts: bootstrap.sh, backup-s3.sh,
# restore.sh, healthcheck.sh, update.sh. Sourced, never executed.
#
# Written for bash 3.2+ (no associative arrays, no mapfile) so the same code
# runs on the Ubuntu host and on a maintainer's Mac during a local drill.
#
# Overridable from the environment:
#   ENV_FILE             path to .env.production (default: <repo>/.env.production)
#   CLUBSPACE_STATE_DIR  where timestamps, alert state and the ops lock live
#                        (default /var/lib/clubspace)
#   COMPOSE_PROJECT_NAME compose project (default: the file's `name: clubspace`)

CS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$CS_ROOT/.env.production}"
CS_STATE_DIR="${CLUBSPACE_STATE_DIR:-/var/lib/clubspace}"
CS_TAG="${CS_TAG:-clubspace}"

log() { printf '%s %s: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$CS_TAG" "$*"; }
warn() { log "ВНИМАНИЕ: $*" >&2; }
die() {
    log "ОШИБКА: $*" >&2
    exit 1
}

# .env.production is compose's env-file format, not shell: a value may hold
# &, ;, spaces or $ (an SMTP password does), so `source` would execute it.
# Parse KEY=VALUE lines instead. Variables already in the environment win, so a
# one-off override (`BACKUP_KEEP_DAILY=3 ./deploy/backup-s3.sh`) works.
load_env() {
    [ -f "$ENV_FILE" ] || die "нет файла $ENV_FILE — сначала deploy/bootstrap.sh"
    local line key val
    while IFS= read -r line || [ -n "$line" ]; do
        line="${line%$'\r'}"
        case "$line" in '' | '#'* | ' '* | $'\t'*) continue ;; esac
        case "$line" in *=*) ;; *) continue ;; esac
        key="${line%%=*}"
        val="${line#*=}"
        key="${key#export }"
        [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
        if [[ "$val" =~ ^\"(.*)\"$ ]] || [[ "$val" =~ ^\'(.*)\'$ ]]; then
            val="${BASH_REMATCH[1]}"
        else
            # Compose strips an unquoted " #comment" tail; so do we.
            val="${val%% #*}"
        fi
        if [ -z "${!key+x}" ]; then export "$key=$val"; fi
    done < "$ENV_FILE"
    # The scripts drive the same stack the README's commands do. COMPOSE_FILE /
    # COMPOSE_PROFILES in .env.production select reverse-proxy mode or the
    # bundled Caddy (bootstrap.sh writes COMPOSE_PROFILES=caddy).
    export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
    CS_PROJECT="${COMPOSE_PROJECT_NAME:-clubspace}"
}

compose() { (cd "$CS_ROOT" && docker compose --env-file "$ENV_FILE" "$@"); }

# A value that is still the template's placeholder counts as unset.
is_placeholder() {
    case "${1:-}" in '' | REPLACE_WITH* | *example.com*) return 0 ;; esac
    return 1
}

state_dir() {
    mkdir -p "$CS_STATE_DIR" 2> /dev/null || die "не могу создать $CS_STATE_DIR (запускайте через sudo или задайте CLUBSPACE_STATE_DIR)"
}

# One ops job at a time: a nightly backup must not start in the middle of an
# update, and two updates must never interleave. Children of a lock holder
# (update.sh -> backup-s3.sh) inherit CS_LOCK_HELD and skip it.
ops_lock() {
    [ -z "${CS_LOCK_HELD:-}" ] || return 0
    command -v flock > /dev/null 2>&1 || return 0
    state_dir
    exec 9> "$CS_STATE_DIR/ops.lock"
    flock -w 3600 9 || die "другая операция (обновление или бэкап) держит блокировку больше часа"
    export CS_LOCK_HELD=1
}

# Seconds since the epoch of a file's content (written by `date +%s`), or 0.
read_epoch() {
    local v
    v="$(cat "$1" 2> /dev/null || true)"
    case "$v" in '' | *[!0-9]*) echo 0 ;; *) echo "$v" ;; esac
}

write_file_atomic() { # write_file_atomic <path> <content>
    local tmp
    tmp="$(mktemp "$(dirname "$1")/.tmp.XXXXXX")"
    printf '%s\n' "$2" > "$tmp"
    mv -f "$tmp" "$1"
}

# ── Alerts ───────────────────────────────────────────────────────────────────
# Telegram (ALERT_TELEGRAM_BOT_TOKEN + ALERT_TELEGRAM_CHAT_ID) and/or e-mail to
# ALERT_EMAIL through the same SMTP relay the app sends sign-in codes with.
# Secrets go to curl through a config on stdin, never on the command line,
# where any local user could read them in `ps`.

curl_cfg_quote() { # escape for a double-quoted curl config value
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    printf '%s' "$s"
}

notify() { # notify <subject> <body>
    local subject="[ClubSpace ${DOMAIN:-}] $1" body="$2" sent=0 text msg url from
    log "уведомление: $1"
    if [ -n "${ALERT_TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${ALERT_TELEGRAM_CHAT_ID:-}" ]; then
        text="$subject"$'\n\n'"$body"
        # Telegram caps a message at 4096 characters; cut on bytes, then drop
        # a multi-byte character the cut may have split (invalid UTF-8 is refused).
        # (iconv -c exits non-zero when it dropped something: that is the point.)
        text="$(printf '%s' "$text" | head -c 3500 | iconv -c -f UTF-8 -t UTF-8 2> /dev/null || true)"
        [ -n "$text" ] || text="$subject"
        if printf 'url = "%s/bot%s/sendMessage"\n' "$(curl_cfg_quote "${ALERT_TELEGRAM_API_URL:-https://api.telegram.org}")" "$(curl_cfg_quote "$ALERT_TELEGRAM_BOT_TOKEN")" \
            | curl -fsS -m 20 -K - --data-urlencode "chat_id=$ALERT_TELEGRAM_CHAT_ID" \
                --data-urlencode "text=$text" -o /dev/null; then
            sent=1
        else
            warn "не удалось отправить алерт в Telegram"
        fi
    fi
    if [ -n "${ALERT_EMAIL:-}" ] && [ -n "${SMTP_URL:-}" ]; then
        from="${SMTP_NO_REPLY_EMAIL:-noreply@${DOMAIN:-localhost}}"
        url="${SMTP_URL%%\?*}"
        msg="$(mktemp)"
        {
            printf 'From: ClubSpace <%s>\r\n' "$from"
            printf 'To: %s\r\n' "$ALERT_EMAIL"
            printf 'Subject: =?UTF-8?B?%s?=\r\n' "$(printf '%s' "$subject" | base64 | tr -d '\n')"
            printf 'Date: %s\r\n' "$(LC_ALL=C date -R 2> /dev/null || LC_ALL=C date '+%a, %d %b %Y %H:%M:%S %z')"
            printf 'MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n'
            printf '%s\r\n' "$body"
        } > "$msg"
        # smtp:// is upgraded with STARTTLS (--ssl-reqd); smtps:// is TLS from
        # the first byte. Credentials embedded in SMTP_URL are used as-is.
        local tls=()
        case "$url" in smtp://*) tls=(--ssl-reqd) ;; esac
        if [ "${ALERT_SMTP_INSECURE:-}" = "1" ]; then tls=(); fi
        if printf 'url = "%s"\n' "$(curl_cfg_quote "$url")" \
            | curl -fsS -m 30 -K - ${tls[@]+"${tls[@]}"} --mail-from "$from" --mail-rcpt "$ALERT_EMAIL" -T "$msg"; then
            sent=1
        else
            warn "не удалось отправить алерт на $ALERT_EMAIL"
        fi
        rm -f "$msg"
    fi
    [ "$sent" = 1 ] || warn "алерт никуда не ушёл — задайте ALERT_TELEGRAM_BOT_TOKEN/ALERT_TELEGRAM_CHAT_ID или ALERT_EMAIL в .env.production. Текст: $body"
    return 0
}

# run_or_alert <subject> <function> [args...]
# Runs the function in a subshell WITH errexit (a function called as an `if`
# condition silently loses `set -e`, so the obvious `if main; then` would
# record a failed pg_dump as a success), shows its output, and on failure sends
# the last lines as an alert.
run_or_alert() {
    local subject="$1" logf rc
    shift
    logf="$(mktemp)"
    set +e
    (
        set -Eeuo pipefail
        "$@"
    ) 2>&1 | tee "$logf"
    rc=${PIPESTATUS[0]}
    set -e
    # Docker's progress lines (" Container … Started", "#7 DONE") would push
    # the actual error out of the message.
    if [ "$rc" -ne 0 ]; then
        notify "$subject" "$(grep -v -e '^ Container ' -e '^ Image ' -e '^#[0-9]' -e '^$' "$logf" | tail -n 25)"
    fi
    rm -f "$logf"
    return "$rc"
}

# ── Backup storage (S3) ──────────────────────────────────────────────────────
# Two modes, chosen by BACKUP_S3_ENDPOINT:
#   empty    -> the stack's own MinIO, bucket BACKUP_S3_BUCKET created on demand.
#               Same disk as the data: protects against a bad update or a
#               dropped table, NOT against losing the server.
#   set      -> any external S3 (Selectel, Timeweb, Yandex, ...) with
#               BACKUP_S3_ACCESS_KEY_ID / BACKUP_S3_SECRET_ACCESS_KEY. The
#               bucket must already exist.
# Objects: <bucket>/<prefix>/db/{daily,weekly,monthly}/db-<stamp>.dump.enc
#          (+ .counts.tsv, row counts taken right after the dump), and in
#          external mode <bucket>/<prefix>/media/<S3_BUCKET_NAME>/... (mirror).

backup_s3_init() {
    BACKUP_S3_BUCKET="${BACKUP_S3_BUCKET:-clubspace-backups}"
    BACKUP_S3_PREFIX="${BACKUP_S3_PREFIX-clubspace}"
    if [ -n "${BACKUP_S3_ENDPOINT:-}" ]; then
        BK_MODE=external
        BK_EP="$BACKUP_S3_ENDPOINT"
        BK_AK="${BACKUP_S3_ACCESS_KEY_ID:-}"
        BK_SK="${BACKUP_S3_SECRET_ACCESS_KEY:-}"
        [ -n "$BK_AK" ] && [ -n "$BK_SK" ] || die "BACKUP_S3_ENDPOINT задан, а BACKUP_S3_ACCESS_KEY_ID / BACKUP_S3_SECRET_ACCESS_KEY — нет"
    else
        BK_MODE=minio
        BK_EP="http://minio:9000"
        BK_AK="${S3_ACCESS_KEY_ID:-}"
        BK_SK="${S3_SECRET_ACCESS_KEY:-}"
        [ -n "$BK_AK" ] && [ -n "$BK_SK" ] || die "нет S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY (root MinIO) в $ENV_FILE"
    fi
    BK_ROOT="$BACKUP_S3_BUCKET${BACKUP_S3_PREFIX:+/$BACKUP_S3_PREFIX}"
    BK_NET="$(docker network ls -q --filter "label=com.docker.compose.project=$CS_PROJECT" \
        --filter label=com.docker.compose.network=bjj_net | head -n 1)"
    if [ "$BK_MODE" = minio ] && [ -z "$BK_NET" ]; then
        die "сеть стека $CS_PROJECT не найдена — MinIO не запущен (docker compose ... up -d minio)"
    fi
    MC_IMAGE="${MINIO_CLIENT_IMAGE:-$(compose config --images 2> /dev/null | grep -m 1 'minio-client' || true)}"
    # `config` refuses to render while anything the file references is missing;
    # the pinned default is right there in the file.
    [ -n "$MC_IMAGE" ] || MC_IMAGE="$(grep -o 'cgr\.dev/chainguard/minio-client@sha256:[0-9a-f]*' "$CS_ROOT/docker-compose.prod.yml" | head -n 1)"
    [ -n "$MC_IMAGE" ] || die "не удалось определить образ minio-client из docker-compose.prod.yml"
}

backup_encryption_key_ok() {
    is_placeholder "${BACKUP_ENCRYPTION_KEY:-}" && die "BACKUP_ENCRYPTION_KEY не задан в $ENV_FILE (deploy/bootstrap.sh --env-only сгенерирует)"
    [ "${#BACKUP_ENCRYPTION_KEY}" -ge 32 ] || die "BACKUP_ENCRYPTION_KEY короче 32 символов"
}

# mc_run '<sh script>' [args...] — run a script in the pinned minio-client
# image with alias `bk` = backup storage and, when the stack network is
# reachable, `local` = the stack's MinIO. stdin/stdout pass through, so
# `mc pipe` / `mc cat` stream files without a bind mount. Credentials travel in
# a 0600 --env-file, not on the docker command line.
mc_run() {
    local script="$1" envf rc=0 net=()
    shift
    envf="$(mktemp)"
    chmod 600 "$envf"
    {
        printf 'BK_EP=%s\nBK_AK=%s\nBK_SK=%s\n' "$BK_EP" "$BK_AK" "$BK_SK"
        printf 'LOCAL_AK=%s\nLOCAL_SK=%s\n' "${S3_ACCESS_KEY_ID:-}" "${S3_SECRET_ACCESS_KEY:-}"
        printf 'MC_CONFIG_DIR=/tmp/.mc\nNEED_LOCAL=%s\n' "${MC_NEED_LOCAL:-}"
    } > "$envf"
    if [ -n "$BK_NET" ]; then net=(--network "$BK_NET"); fi
    # shellcheck disable=SC2016 # expanded by the container's shell
    docker run --rm -i --user 0:0 ${net[@]+"${net[@]}"} --env-file "$envf" --entrypoint /bin/sh "$MC_IMAGE" -c '
        set -e
        mc alias set bk "$BK_EP" "$BK_AK" "$BK_SK" > /dev/null
        if [ -n "$LOCAL_AK" ] && [ "$BK_EP" != "http://minio:9000" ] && [ "${NEED_LOCAL:-}" = 1 ]; then
            mc alias set local http://minio:9000 "$LOCAL_AK" "$LOCAL_SK" > /dev/null
        fi
        '"$script" sh "$@" || rc=$?
    rm -f "$envf"
    return "$rc"
}

# Names of encrypted dumps in a tier, oldest first. Names carry a sortable UTC
# timestamp, so name order is age order.
list_dumps() { # list_dumps daily|weekly|monthly
    # shellcheck disable=SC2016
    mc_run 'mc ls "bk/$1/" 2> /dev/null || true' "$BK_ROOT/db/$1" | awk '{print $NF}' | grep '\.dump\.enc$' | sort || true
}

# Exact row count of every table in the public schema, "name<TAB>count", one
# per line, sorted. Same query on the live database and on a restored copy.
# shellcheck disable=SC2034 # used by the scripts that source this file
COUNTS_SQL="SELECT c.relname || E'\t' || (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I.%I', n.nspname, c.relname), false, true, '')))[1]::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname;"

# openssl parameters shared by encryption and decryption. AES-256 with a
# PBKDF2-stretched key; the dump itself is already zlib-compressed (pg_dump -Fc).
# shellcheck disable=SC2034
OPENSSL_ENC_ARGS=(-aes-256-cbc -md sha256 -pbkdf2 -iter 200000 -salt -pass env:BACKUP_ENCRYPTION_KEY)
