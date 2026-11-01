#!/usr/bin/env bash
# Encrypted off-host database backup to S3 — run nightly by the
# clubspace-backup.timer systemd unit (bootstrap.sh installs it), and by
# update.sh before every update.
#
#   sudo ./deploy/backup-s3.sh
#
# Each run:
#   1. pg_dump -Fc (compressed) from the running postgres container, plus the
#      exact row count of every table taken right after it (*.counts.tsv —
#      what restore.sh --check compares a restored copy against)
#   2. checks the dump's table of contents lists as many tables as the
#      database has, encrypts it (AES-256, key BACKUP_ENCRYPTION_KEY) and
#      proves the ciphertext decrypts back to the same bytes
#   3. uploads to <bucket>/<prefix>/db/daily/, and the first good backup of an
#      ISO week / a month is also copied to weekly/ and monthly/
#   4. prunes: newest BACKUP_KEEP_DAILY (7) daily, BACKUP_KEEP_WEEKLY (4)
#      weekly, BACKUP_KEEP_MONTHLY (6) monthly are kept
#   5. external S3 only: mirrors the video bucket to <prefix>/media/ (new and
#      changed objects; deletions in the app are not propagated)
#   6. records the success time for healthcheck.sh; any failure is alerted
#
# Storage: the stack's MinIO when BACKUP_S3_ENDPOINT is empty, any external
# S3 otherwise — see deploy/lib/common.sh and deploy/README.md.
#
# Without BACKUP_ENCRYPTION_KEY a backup is unreadable, including by you: keep
# it (and the whole .env.production) in a password manager off this server.
set -Eeuo pipefail
umask 077

CS_TAG=backup-s3
# shellcheck source=deploy/lib/common.sh
. "$(dirname "$0")/lib/common.sh"

backup() {
    local work stamp dump enc counts toc_tables db_tables key size_local size_remote wk mo tier keep doomed
    work="$(mktemp -d "${TMPDIR:-/var/tmp}/clubspace-backup.XXXXXX")"
    # shellcheck disable=SC2064 # expand now: $work is local
    trap "rm -rf '$work'" EXIT
    stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
    dump="$work/db.dump"
    enc="$work/db.dump.enc"
    counts="$work/counts.tsv"

    compose ps --status running --services 2> /dev/null | grep -qx postgres || die "контейнер postgres не запущен"
    backup_encryption_key_ok

    log "pg_dump…"
    # shellcheck disable=SC2016 # expanded inside the container
    compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -Z 6' > "$dump"
    [ -s "$dump" ] || die "pg_dump вернул пустой файл"
    # shellcheck disable=SC2016
    printf '%s\n' "$COUNTS_SQL" | compose exec -T postgres sh -c 'psql -X -q -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$counts"

    # The dump must be readable and list every table the database has.
    toc_tables="$(compose exec -T postgres pg_restore --list < "$dump" | awk '$4 == "TABLE" && $5 == "public" { n++ } END { print n + 0 }')"
    db_tables="$(grep -c . "$counts" || true)"
    [ "$toc_tables" = "$db_tables" ] || die "в дампе $toc_tables таблиц, в базе $db_tables"

    openssl enc -e "${OPENSSL_ENC_ARGS[@]}" -in "$dump" -out "$enc"
    openssl enc -d "${OPENSSL_ENC_ARGS[@]}" -in "$enc" | cmp -s - "$dump" || die "зашифрованный файл не расшифровывается обратно"

    backup_s3_init
    if [ "$BK_MODE" = minio ]; then
        warn "BACKUP_S3_ENDPOINT пуст — копия кладётся в MinIO этого же сервера. От потери сервера это не спасает: задайте внешний S3."
        # shellcheck disable=SC2016
        mc_run 'mc mb --ignore-existing "bk/$1" > /dev/null' "$BACKUP_S3_BUCKET"
    fi

    key="$BK_ROOT/db/daily/db-$stamp"
    log "загружаю $key.dump.enc ($(du -h "$enc" | cut -f1))"
    # shellcheck disable=SC2016
    mc_run 'mc pipe "bk/$1" > /dev/null' "$key.dump.enc" < "$enc"
    # shellcheck disable=SC2016
    mc_run 'mc pipe "bk/$1" > /dev/null' "$key.counts.tsv" < "$counts"
    size_local="$(wc -c < "$enc" | tr -d ' ')"
    # shellcheck disable=SC2016
    size_remote="$(mc_run 'mc stat --json "bk/$1"' "$key.dump.enc" | grep -o '"size":[0-9]*' | head -n 1 | cut -d: -f2)"
    [ "$size_local" = "$size_remote" ] || die "размер в S3 ($size_remote) не совпадает с локальным ($size_local)"

    # First good backup of the week / month is promoted (server-side copy).
    wk="$(date -u +%G-W%V)"
    mo="$(date -u +%Y-%m)"
    # shellcheck disable=SC2016
    mc_run '
        src="bk/$1"
        for dst in "bk/$2" "bk/$3"; do
            if ! mc stat "$dst.dump.enc" > /dev/null 2>&1; then
                mc cp --quiet "$src.dump.enc" "$dst.dump.enc" > /dev/null
                mc cp --quiet "$src.counts.tsv" "$dst.counts.tsv" > /dev/null
                echo "promoted ${dst#bk/}"
            fi
        done' "$key" "$BK_ROOT/db/weekly/db-$wk" "$BK_ROOT/db/monthly/db-$mo"

    for tier in daily weekly monthly; do
        case "$tier" in
            daily) keep="${BACKUP_KEEP_DAILY:-7}" ;;
            weekly) keep="${BACKUP_KEEP_WEEKLY:-4}" ;;
            monthly) keep="${BACKUP_KEEP_MONTHLY:-6}" ;;
        esac
        [ "$keep" -ge 1 ] || keep=1
        doomed="$(list_dumps "$tier" | sort -r | tail -n +"$((keep + 1))")"
        [ -n "$doomed" ] || continue
        # shellcheck disable=SC2016
        printf '%s\n' "$doomed" | mc_run '
            while read -r f; do
                [ -n "$f" ] || continue
                mc rm --quiet "bk/$1/$f" > /dev/null
                mc rm --quiet "bk/$1/${f%.dump.enc}.counts.tsv" > /dev/null 2>&1 || true
                echo "pruned $1/$f"
            done' "$BK_ROOT/db/$tier"
    done

    log "ok: $key.dump.enc, таблиц $db_tables, строк $(awk -F'\t' '{ s += $2 } END { print s + 0 }' "$counts")"

    if [ "$BK_MODE" = external ] && [ "${BACKUP_S3_MEDIA:-true}" != false ]; then
        log "зеркалирую видео-бакет ${S3_BUCKET_NAME:-clubspace} → $BK_ROOT/media/"
        # shellcheck disable=SC2016
        MC_NEED_LOCAL=1 mc_run 'mc mirror --quiet --overwrite "local/$1" "bk/$2"' \
            "${S3_BUCKET_NAME:-clubspace}" "$BK_ROOT/media/${S3_BUCKET_NAME:-clubspace}"
        log "ok: видео зеркалированы"
    fi

    state_dir
    write_file_atomic "$CS_STATE_DIR/backup-s3.last-ok" "$(date +%s)"
    write_file_atomic "$CS_STATE_DIR/backup-s3.last-key" "$key.dump.enc"
}

load_env
ops_lock
run_or_alert "Бэкап в S3 НЕ сделан" backup
