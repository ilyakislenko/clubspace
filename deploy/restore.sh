#!/usr/bin/env bash
# Restore a database backup made by backup-s3.sh.
#
#   ./deploy/restore.sh --list                         copies in S3, oldest first
#   ./deploy/restore.sh --check [latest|KEY]           restore into a throwaway
#                                                      container and verify
#   ./deploy/restore.sh --to-production KEY --yes      REPLACE the live database
#   ./deploy/restore.sh --download [latest|KEY] OUT.dump  decrypt to a file
#
# KEY is what --list prints, e.g. daily/db-2026-11-01T033000Z.dump.enc
# (a bare file name is looked up in daily/, weekly/, monthly/). Instead of a KEY,
# --file PATH.dump.enc takes an encrypted dump from disk (its .counts.tsv
# next to it is used when present).
#
# --check is what the monthly clubspace-restore-check.timer runs (with
# --report, which sends the result even when it passes): it restores into a
# scratch postgres container with no network, then compares the row count of
# every table with the counts recorded at backup time (tolerance: 1% or 5
# rows, whichever is larger — rows written in the second between the dump and
# the count). Production is not touched.
#
# --to-production stops server, video-worker and db-backup, saves the current
# database to $CLUBSPACE_STATE_DIR/pre-restore-<stamp>.dump (skip with
# --no-safety-dump), recreates the database from the backup and starts them
# again. Needs the BACKUP_ENCRYPTION_KEY the backup was made with — and the
# rest of the same .env.production (ENCRYPTION_SECRET decrypts stored fields).
set -Eeuo pipefail
umask 077

CS_TAG=restore
# shellcheck source=deploy/lib/common.sh
. "$(dirname "$0")/lib/common.sh"

usage() { sed -n '2,26p' "$0" | sed 's|^# \{0,1\}||'; }

MODE=""
KEY=""
FILE=""
OUT=""
YES=0
REPORT=0
SAFETY=1
while [ $# -gt 0 ]; do
    case "$1" in
        --list) MODE=list; shift ;;
        --check) MODE=check; shift ;;
        --to-production) MODE=prod; shift ;;
        --download) MODE=download; shift ;;
        --file) FILE="${2:?--file needs a path}"; shift 2 ;;
        --yes) YES=1; shift ;;
        --report) REPORT=1; shift ;;
        --no-safety-dump) SAFETY=0; shift ;;
        -h | --help) usage; exit 0 ;;
        -*) usage; die "неизвестный параметр: $1" ;;
        *)
            if [ -z "$KEY" ]; then
                KEY="$1"
            elif [ -z "$OUT" ]; then
                OUT="$1"
            else
                usage; die "лишний аргумент: $1"
            fi
            shift
            ;;
    esac
done
[ -n "$MODE" ] || { usage; exit 2; }
# `--download OUT.dump` with --file: the one positional is the output.
if [ "$MODE" = download ] && [ -n "$FILE" ] && [ -z "$OUT" ]; then OUT="$KEY"; KEY=""; fi

resolve_key() {
    local tier found
    case "$KEY" in
        '' | latest)
            KEY="$(list_dumps daily | tail -n 1)"
            [ -n "$KEY" ] || die "в $BK_ROOT/db/daily/ нет ни одной копии"
            KEY="daily/$KEY"
            ;;
        */*) ;;
        *)
            for tier in daily weekly monthly; do
                found="$(list_dumps "$tier" | grep -x "$KEY" || true)"
                if [ -n "$found" ]; then KEY="$tier/$KEY"; return 0; fi
            done
            die "копия $KEY не найдена (см. --list)"
            ;;
    esac
}

# Fills $WORK/db.dump (decrypted) and, when it exists, $WORK/counts.tsv.
fetch() {
    if [ -n "$FILE" ]; then
        [ -f "$FILE" ] || die "нет файла $FILE"
        cp "$FILE" "$WORK/db.dump.enc"
        if [ -f "${FILE%.dump.enc}.counts.tsv" ]; then cp "${FILE%.dump.enc}.counts.tsv" "$WORK/counts.tsv"; fi
        SOURCE="$FILE"
    else
        backup_s3_init
        resolve_key
        SOURCE="$BK_ROOT/db/$KEY"
        log "скачиваю $SOURCE"
        # shellcheck disable=SC2016
        mc_run 'mc cat "bk/$1"' "$SOURCE" > "$WORK/db.dump.enc"
        # shellcheck disable=SC2016
        mc_run 'mc cat "bk/$1" 2> /dev/null || true' "${SOURCE%.dump.enc}.counts.tsv" > "$WORK/counts.tsv"
        [ -s "$WORK/counts.tsv" ] || rm -f "$WORK/counts.tsv"
    fi
    [ -s "$WORK/db.dump.enc" ] || die "пустой файл копии"
    backup_encryption_key_ok
    openssl enc -d "${OPENSSL_ENC_ARGS[@]}" -in "$WORK/db.dump.enc" -out "$WORK/db.dump" 2> /dev/null \
        || die "не удалось расшифровать — BACKUP_ENCRYPTION_KEY не тот, с которым делалась копия?"
    rm -f "$WORK/db.dump.enc"
}

pg_image() {
    local cid
    cid="$(compose ps -q postgres 2> /dev/null || true)"
    if [ -n "$cid" ]; then
        docker inspect -f '{{.Config.Image}}' "$cid"
        return 0
    fi
    compose config --images 2> /dev/null | grep -m 1 '^postgres' || echo postgres:16-alpine
}

do_list() {
    local tier
    backup_s3_init
    for tier in daily weekly monthly; do
        list_dumps "$tier" | sed "s|^|$tier/|"
    done
}

do_check() {
    local name image started secs i toc restored_tables rows mismatches report
    WORK="$(mktemp -d "${TMPDIR:-/var/tmp}/clubspace-restore.XXXXXX")"
    name="clubspace-restore-check-$$"
    # shellcheck disable=SC2064
    trap "docker rm -f '$name' > /dev/null 2>&1 || true; rm -rf '$WORK'" EXIT
    fetch
    image="$(pg_image)"
    log "временный контейнер $name ($image), без сети"
    docker run -d --name "$name" --network none \
        -e POSTGRES_PASSWORD="$(openssl rand -hex 16)" -e POSTGRES_DB=restore_check \
        "$image" > /dev/null
    # TCP, not the socket: the image's init phase runs a socket-only server
    # that pg_isready would happily report as ready before the real start.
    i=0
    until docker exec "$name" pg_isready -q -h 127.0.0.1 -U postgres -d restore_check; do
        i=$((i + 1))
        [ "$i" -lt 90 ] || die "временный postgres не поднялся за 90 с"
        sleep 1
    done

    started="$(date +%s)"
    docker exec -i "$name" pg_restore -U postgres -d restore_check --no-owner --no-privileges --exit-on-error < "$WORK/db.dump"
    secs=$(($(date +%s) - started))

    printf '%s\n' "$COUNTS_SQL" | docker exec -i "$name" psql -X -q -At -v ON_ERROR_STOP=1 -U postgres -d restore_check > "$WORK/restored.tsv"
    toc="$(docker exec -i "$name" pg_restore --list < "$WORK/db.dump" | awk '$4 == "TABLE" && $5 == "public" { n++ } END { print n + 0 }')"
    restored_tables="$(grep -c . "$WORK/restored.tsv" || true)"
    rows="$(awk -F'\t' '{ s += $2 } END { print s + 0 }' "$WORK/restored.tsv")"

    report="Копия: $SOURCE
Восстановлено за ${secs} с: таблиц $restored_tables (в дампе $toc), строк $rows"
    mismatches=0
    if [ "$restored_tables" != "$toc" ]; then
        mismatches=1
        report="$report
✗ восстановлено $restored_tables таблиц из $toc"
    fi
    if [ -f "$WORK/counts.tsv" ]; then
        local diff
        diff="$(awk -F'\t' '
            NR == FNR { got[$1] = $2; next }
            {
                want = $2 + 0
                if (!($1 in got)) { printf "✗ %s: нет в копии (ожидалось %d)\n", $1, want; next }
                d = got[$1] - want; if (d < 0) d = -d
                tol = want / 100; if (tol < 5) tol = 5
                if (d > tol) printf "✗ %s: %d строк, при бэкапе было %d\n", $1, got[$1], want
            }' "$WORK/restored.tsv" "$WORK/counts.tsv")"
        if [ -n "$diff" ]; then
            mismatches=1
            report="$report
$diff"
        else
            report="$report
✓ строки всех таблиц совпадают со снятыми при бэкапе"
        fi
    else
        report="$report
(нет .counts.tsv — сверено только число таблиц)"
    fi
    report="$report
Крупнейшие таблицы:
$(sort -t "$(printf '\t')" -k2,2nr "$WORK/restored.tsv" | head -n 8 | awk -F'\t' '{ printf "  %s %s\n", $1, $2 }')"

    printf '%s\n' "$report"
    [ "$mismatches" = 0 ] || die "проверка восстановления не прошла"
    if [ "$REPORT" = 1 ]; then notify "Проверка восстановления бэкапа: OK" "$report"; fi
    log "ok: копия восстанавливается, строки сходятся"
}

do_prod() {
    local running stamp i
    WORK="$(mktemp -d "${TMPDIR:-/var/tmp}/clubspace-restore.XXXXXX")"
    # shellcheck disable=SC2064
    trap "rm -rf '$WORK'" EXIT
    fetch
    compose exec -T postgres pg_restore --list < "$WORK/db.dump" > /dev/null || die "файл копии повреждён"

    if [ "$SAFETY" = 1 ]; then
        state_dir
        stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
        # shellcheck disable=SC2016
        compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$CS_STATE_DIR/pre-restore-$stamp.dump"
        log "текущая база сохранена: $CS_STATE_DIR/pre-restore-$stamp.dump"
    fi

    running="$(compose ps --status running --services 2> /dev/null | grep -Ex 'server|video-worker|db-backup' || true)"
    # shellcheck disable=SC2086 # a list of service names
    if [ -n "$running" ]; then compose stop $running; fi
    log "пересоздаю базу и восстанавливаю $SOURCE"
    # shellcheck disable=SC2016
    compose exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" --force --if-exists "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
    # shellcheck disable=SC2016
    compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error' < "$WORK/db.dump"
    # shellcheck disable=SC2086
    if [ -n "$running" ]; then compose start $running; fi

    if printf '%s\n' "$running" | grep -qx server; then
        i=0
        until compose exec -T server wget -qO- http://127.0.0.1:3000/healthz > /dev/null 2>&1; do
            i=$((i + 1))
            [ "$i" -lt 60 ] || die "база восстановлена, но server не отвечает на /healthz: docker compose logs server"
            sleep 3
        done
    fi
    log "ok: база восстановлена из $SOURCE"
}

do_download() {
    [ -n "$OUT" ] || die "укажите файл: --download [KEY] OUT.dump"
    WORK="$(mktemp -d "${TMPDIR:-/var/tmp}/clubspace-restore.XXXXXX")"
    # shellcheck disable=SC2064
    trap "rm -rf '$WORK'" EXIT
    fetch
    mv "$WORK/db.dump" "$OUT"
    if [ -f "$WORK/counts.tsv" ]; then mv "$WORK/counts.tsv" "${OUT%.dump}.counts.tsv"; fi
    log "ok: $OUT (pg_restore -Fc; восстановить: pg_restore -d <db> --no-owner $OUT)"
}

load_env
case "$MODE" in
    list) do_list ;;
    download) do_download ;;
    check)
        ops_lock
        run_or_alert "Проверка восстановления бэкапа НЕ прошла" do_check
        ;;
    prod)
        [ "$YES" = 1 ] || die "это заменит боевую базу. Повторите с --yes"
        [ -n "$KEY" ] || [ -n "$FILE" ] || die "укажите копию явно: KEY из --list, latest или --file PATH"
        ops_lock
        run_or_alert "Восстановление боевой базы НЕ удалось" do_prod
        ;;
esac
