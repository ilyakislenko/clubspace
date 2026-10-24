#!/bin/sh
# Object-store backup, run by the `media-backup` service in
# docker-compose.prod.yml (minio/mc image).
#
# Incremental: `mc mirror` copies only objects the backup doesn't have yet, so
# the backup is ONE copy of the library that grows as videos are added — not a
# full tarball every week kept for a month, which on a home server meant four
# or five copies of every video on the same disk.
#
# --overwrite: a re-transcoded video rewrites hls/<id>/, and without it mc keeps
# the stale copy, prints "Overwrite not allowed" and still exits 0.
# No --remove: deleting a video in the app does not delete it from the backup.
# That is the point of a backup (an accidental delete is recoverable); prune
# the mirror by hand if the disk ever needs it.
set -eu
set -o pipefail
umask 077

# Monitoring: so that ONE monitor URL covers both backups, this script doesn't
# ping anything itself. It leaves LAST_MEDIA_FAILURE in the backup dir, and
# db-backup.sh reports that marker on its next round.
: "${S3_BUCKET_NAME:=clubspace}"
: "${BACKUP_DIR:=/backups}"
: "${BACKUP_INTERVAL_HOURS:=24}"

log() { printf '%s media-backup: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

attempt=0
until mc alias set local http://minio:9000 "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" > /dev/null 2>&1; do
    attempt=$((attempt + 1))
    # Storage still down (or wrong credentials) after ~5 minutes: say so, and
    # leave the marker db-backup reports, instead of waiting in silence.
    if [ "$attempt" -eq 60 ]; then
        log "cannot reach storage at minio:9000 — check S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY"
        date -u +%Y-%m-%dT%H:%M:%SZ > "$BACKUP_DIR/LAST_MEDIA_FAILURE" 2> /dev/null || true
    fi
    sleep 5
done
mkdir -p "$BACKUP_DIR/media" 2> /dev/null || true

while true; do
    if mc mirror --quiet --preserve --overwrite "local/$S3_BUCKET_NAME" "$BACKUP_DIR/media/$S3_BUCKET_NAME"; then
        log "ok: $(du -sh "$BACKUP_DIR/media" | cut -f1) mirrored"
        rm -f "$BACKUP_DIR/LAST_MEDIA_FAILURE"
    else
        log "FAILED — existing mirror kept"
        date -u +%Y-%m-%dT%H:%M:%SZ > "$BACKUP_DIR/LAST_MEDIA_FAILURE" 2> /dev/null || true
    fi
    sleep "$((BACKUP_INTERVAL_HOURS * 3600))"
done
