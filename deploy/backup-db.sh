#!/bin/sh
# Nightly Postgres backup, run by the `db-backup` service in
# docker-compose.prod.yml (postgres image, so pg_dump/pg_restore match the
# server version). A dump only counts once it has been RESTORED somewhere and
# looked at: a backup that was never restored is a hope, not a backup.
#
# Each round:
#   1. pg_dump -Fc into a temp file (pipefail: a failed dump is a failure, not
#      a small valid-looking file)
#   2. restore it into a scratch database and count the users in it
#   3. only then promote it to db-<timestamp>.dump and prune old ones —
#      never below BACKUP_KEEP_MIN, so a run of failures can't age out the
#      last good dumps
#   4. ping BACKUP_HEALTHCHECK_URL (healthchecks.io-style) on success, /fail
#      on failure, so a silent stop is noticed by something other than luck
#
# Runs once at container start (every deploy gets a fresh dump), then every
# BACKUP_INTERVAL_HOURS.
set -eu
set -o pipefail
# Dumps hold every member's data; keep them readable by root only.
umask 077

: "${PGHOST:=postgres}"
: "${PGUSER:=postgres}"
: "${POSTGRES_DB:=clubspace}"
: "${BACKUP_DIR:=/backups}"
: "${BACKUP_RETENTION_DAYS:=14}"
: "${BACKUP_KEEP_MIN:=7}"
: "${BACKUP_INTERVAL_HOURS:=24}"
: "${BACKUP_HEALTHCHECK_URL:=}"
export PGHOST PGUSER

SCRATCH_DB="restore_check"
TABLES_SQL="SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'"

log() { printf '%s db-backup: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

ping_monitor() {
    [ -n "$BACKUP_HEALTHCHECK_URL" ] || return 0
    wget -q -T 10 -O /dev/null "$BACKUP_HEALTHCHECK_URL$1" || log "monitor ping failed (non-fatal)"
}

# Every step is checked by hand. `set -e` does NOT protect this function: it is
# called as an `if` condition, and POSIX sh ignores -e for the whole body of a
# condition — even inside a subshell. Relying on it once let a failed pg_dump
# record a 0-byte file as "ok" and prune a good dump to make room.
backup_once() {
    stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
    tmp="$BACKUP_DIR/.db-$stamp.dump.partial"
    final="$BACKUP_DIR/db-$stamp.dump"

    pg_dump -d "$POSTGRES_DB" -Fc -f "$tmp" || return 1
    pg_restore --list "$tmp" > /dev/null || return 1

    dropdb --if-exists "$SCRATCH_DB" || return 1
    createdb "$SCRATCH_DB" || return 1
    # --no-owner: the scratch DB is ours; ownership is irrelevant to the check.
    pg_restore -d "$SCRATCH_DB" --no-owner --exit-on-error "$tmp" || return 1

    # The restored copy must have every table the dump itself lists. Compared
    # to the dump (not the live DB, which the server may be changing at boot)
    # and counted (not rows of one table), so it also holds on a fresh install
    # where there are no tables yet.
    dumped_tables="$(pg_restore --list "$tmp" | awk '$4 == "TABLE" && $5 == "public" { n++ } END { print n + 0 }')" || return 1
    restored_tables="$(psql -d "$SCRATCH_DB" -tAc "$TABLES_SQL")" || return 1
    if [ "$dumped_tables" != "$restored_tables" ]; then
        log "restore check: $restored_tables tables restored, $dumped_tables in the dump"
        return 1
    fi
    # Informational only — "User" doesn't exist until the first server boot.
    users="$(psql -d "$SCRATCH_DB" -tAc 'SELECT count(*) FROM "User"' 2>/dev/null || echo n/a)"
    dropdb "$SCRATCH_DB" || return 1

    mv "$tmp" "$final" || return 1
    log "ok: $final ($(du -h "$final" | cut -f1), restore check: $restored_tables tables, $users users)"

    # Prune by age, but always keep the newest BACKUP_KEEP_MIN dumps.
    # Names carry a sortable UTC timestamp, so name order is age order.
    ls -1 "$BACKUP_DIR"/db-*.dump 2>/dev/null | sort -r | tail -n +"$((BACKUP_KEEP_MIN + 1))" | while read -r old; do
        if [ -n "$(find "$old" -mtime +"$BACKUP_RETENTION_DAYS")" ]; then
            rm -f "$old" && log "pruned $old"
        fi
    done
}

# Not fatal: an unwritable BACKUP_DIR (read-only or root-squashed mount, full
# disk) must reach the failure branch below and ping /fail, not crash-loop.
mkdir -p "$BACKUP_DIR" 2> /dev/null || true
until pg_isready -q -d "$POSTGRES_DB"; do sleep 5; done

while true; do
    rm -f "$BACKUP_DIR"/.db-*.dump.partial 2> /dev/null || true
    if ( backup_once ); then
        rm -f "$BACKUP_DIR/LAST_FAILURE"
        # One monitor URL covers both backups: media-backup can't ping (no
        # HTTP client in its image), so its failure marker is reported here.
        if [ -f "$BACKUP_DIR/LAST_MEDIA_FAILURE" ]; then
            log "media mirror failing since $(cat "$BACKUP_DIR/LAST_MEDIA_FAILURE")"
            ping_monitor "/fail"
        else
            ping_monitor ""
        fi
    else
        log "FAILED — previous dumps kept"
        # Ping first: if the failure IS the backup dir, writing the marker fails.
        ping_monitor "/fail"
        date -u +%Y-%m-%dT%H:%M:%SZ > "$BACKUP_DIR/LAST_FAILURE" 2> /dev/null || true
        dropdb --if-exists "$SCRATCH_DB" 2> /dev/null || true
    fi
    sleep "$((BACKUP_INTERVAL_HOURS * 3600))"
done
