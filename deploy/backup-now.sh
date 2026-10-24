#!/bin/sh
# Take a verified database backup NOW and wait for its verdict:
#
#   ./deploy/backup-now.sh
#
# Run it before an update or a deliberate schema change. Exits 0 with the
# "ok: … restore check" line, or non-zero with the failure — so it can gate the
# next command (`./deploy/backup-now.sh && docker compose … up -d`).
#
# `docker compose up -d` does not restart an unchanged db-backup container, so
# an update would otherwise run on yesterday's dump. Recreating it makes
# backup-db.sh take a fresh dump at start.
#
# COMPOSE overrides the compose invocation, e.g. for the reverse-proxy mode:
#   COMPOSE="docker compose -f docker-compose.prod.yml -f docker-compose.proxy.yml --env-file .env.production" ./deploy/backup-now.sh
set -eu

cd "$(dirname "$0")/.."
COMPOSE="${COMPOSE:-docker compose -f docker-compose.prod.yml --env-file .env.production}"

since="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
# COMPOSE is a deliberate multi-word command.
# shellcheck disable=SC2086
$COMPOSE up -d --no-deps --force-recreate db-backup > /dev/null 2>&1

i=0
while [ "$i" -lt 120 ]; do
    # shellcheck disable=SC2086
    out="$($COMPOSE logs --no-log-prefix --since "$since" db-backup 2> /dev/null || true)"
    case "$out" in
        *"db-backup: ok:"*)
            printf '%s\n' "$out" | grep 'db-backup: ok:' | tail -1
            exit 0
            ;;
        *"db-backup: FAILED"*)
            printf '%s\n' "$out" | tail -20 >&2
            exit 1
            ;;
    esac
    i=$((i + 1))
    sleep 5
done

echo "db-backup gave no verdict within 10 minutes — see: $COMPOSE logs db-backup" >&2
exit 1
