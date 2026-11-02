#!/usr/bin/env bash
# Update a running install to the latest code, with a backup first and an
# automatic rollback when the new version does not come up.
#
#   sudo ./deploy/update.sh                 fast-forward the checked-out branch to origin
#   sudo ./deploy/update.sh --ref v1.4.0    a tag / branch / commit instead
#   sudo ./deploy/update.sh --force         rebuild and restart even without new commits
#   sudo ./deploy/update.sh --skip-backup   do not take the backup (not recommended)
#
# Order — the old version keeps serving until step 5:
#   1. git: fast-forward (refuses a dirty or diverged checkout)
#   2. build the five app images (server, video-worker, admin, client, pwa); the
#      running containers' images are tagged :rollback first
#   3. deploy/backup-s3.sh — encrypted, verified backup to S3; stops here if it fails
#   4. one-off data migrations from apps/server/scripts/, each ONLY when the
#      database still has the shape it migrates from (see MIGRATIONS below);
#      the apps are stopped first when one is needed — they are written for
#      the new schema
#   5. `prisma db push` with the NEW image, then a post-push backfill if
#      needed, then `docker compose up -d` (seconds of downtime per container)
#   6. smoke check: server healthy and /healthz ok inside the container, the
#      worker and both web apps running without restarts; public /healthz is
#      reported but does not gate (DNS/hairpin)
#   7. on failure at any step: :rollback images re-tagged as current, the git
#      checkout moved back, the old containers started again, alert sent. A
#      data migration is not undone — the alert names the backup to restore
#      from (deploy/restore.sh --to-production <key> --yes) when one ran.
# shellcheck disable=SC2329 # functions run via run_or_alert and the EXIT trap
set -Eeuo pipefail

CS_TAG=update
# shellcheck source=deploy/lib/common.sh
. "$(dirname "$0")/lib/common.sh"

APP_SERVICES="server video-worker admin client pwa"
IMAGE_REPO="clubspace.local"
REF=""
FORCE=0
SKIP_BACKUP=0
while [ $# -gt 0 ]; do
    case "$1" in
        --ref) REF="${2:?--ref needs a value}"; shift 2 ;;
        --force) FORCE=1; shift ;;
        --skip-backup) SKIP_BACKUP=1; shift ;;
        -h | --help) sed -n '2,27p' "$0" | sed 's|^# \{0,1\}||'; exit 0 ;;
        *) die "неизвестный параметр: $1" ;;
    esac
done

# Data migrations shipped with the code: "<file>|<phase>|<SQL that is true
# while the migration is still needed>". pre = before `db push` (the script
# moves data out of columns the new schema drops, which push would refuse),
# post = after it (fills a table push has just created). Every script is
# idempotent on its own; the detection only keeps it from running needlessly.
audit_legacy_actions() {
    grep -o "WHERE action = '[^']*'" "$CS_ROOT/apps/server/scripts/migrate-audit-action-names.sql" \
        | sed "s/WHERE action = //" | paste -sd, -
}
migrations() {
    cat <<EOF
migrate-billing-v2.sql|pre|SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'WorkspaceBilling' AND column_name = 'planId') OR to_regclass('public."PlatformPlan"') IS NOT NULL
migrate-parallel-abonements.sql|pre|SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND ((table_name = 'Plan' AND column_name = 'directionId') OR (table_name = 'WorkspaceMember' AND column_name = 'subscriptionId')))
migrate-audit-action-names.sql|pre|SELECT CASE WHEN to_regclass('public."AuditEvent"') IS NULL THEN false ELSE (xpath('/row/x/text()', query_to_xml('SELECT EXISTS (SELECT 1 FROM "AuditEvent" WHERE action IN ($(audit_legacy_actions | sed "s/'/''/g"))) AS x', false, true, '')))[1]::text::boolean END
backfill-group-coach-junction.sql|post|SELECT CASE WHEN to_regclass('public."GroupCoach"') IS NULL THEN false ELSE (xpath('/row/x/text()', query_to_xml('SELECT EXISTS (SELECT 1 FROM "Group" g WHERE NOT EXISTS (SELECT 1 FROM "GroupCoach" gc WHERE gc."groupId" = g.id AND gc."userId" = g."coachId")) AS x', false, true, '')))[1]::text::boolean END
backfill-subscription-user.sql|post|SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Subscription' AND column_name = 'userId') THEN false ELSE (xpath('/row/x/text()', query_to_xml('SELECT EXISTS (SELECT 1 FROM "Subscription" WHERE "userId" IS NULL AND "workspaceMemberId" IS NOT NULL) AS x', false, true, '')))[1]::text::boolean END
EOF
}

psql_stdin() {
    # shellcheck disable=SC2016
    compose exec -T postgres sh -c 'psql -X -q -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
}

needed_migrations() { # needed_migrations pre|post -> file names, one per line
    local file phase sql v
    while IFS='|' read -r file phase sql; do
        [ "$phase" = "$1" ] || continue
        [ -f "$CS_ROOT/apps/server/scripts/$file" ] || continue
        # Anything but a clean t/f (psql failed, postgres down) is an error,
        # never a silent "not needed".
        v="$(printf '%s;\n' "$sql" | psql_stdin)" || return 1
        case "$v" in
            t) echo "$file" ;;
            f) ;;
            *) return 1 ;;
        esac
    done < <(migrations)
}

run_migrations() {
    local f
    for f in "$@"; do
        log "миграция данных: apps/server/scripts/$f"
        psql_stdin < "$CS_ROOT/apps/server/scripts/$f" > /dev/null
    done
}

PREV_SHA=""
PREV_BRANCH=""
TARGET=""
SWITCHED=0
MIGRATED=0
BACKUP_KEY=""
ROLLBACK_TAGGED=0
ROLLED_BACK=""

rollback() {
    local reason="$1" svc
    ROLLED_BACK=1
    warn "откат: $reason"
    if [ "$ROLLBACK_TAGGED" = 1 ]; then
        for svc in $APP_SERVICES; do
            if docker image inspect "$IMAGE_REPO/$svc:rollback" > /dev/null 2>&1; then
                docker tag "$IMAGE_REPO/$svc:rollback" "$IMAGE_REPO/$svc:latest"
            fi
        done
    fi
    if [ "$(git -C "$CS_ROOT" rev-parse HEAD)" != "$PREV_SHA" ]; then
        if [ -n "$PREV_BRANCH" ]; then
            git -C "$CS_ROOT" checkout -q --detach
            git -C "$CS_ROOT" branch -f "$PREV_BRANCH" "$PREV_SHA"
            git -C "$CS_ROOT" checkout -q "$PREV_BRANCH"
        else
            git -C "$CS_ROOT" checkout -q --detach "$PREV_SHA"
        fi
    fi
    if [ "$SWITCHED" = 1 ]; then
        compose up -d --no-build || warn "не удалось поднять прежнюю версию — docker compose ps / logs"
    fi
    local hint=""
    if [ "$MIGRATED" = 1 ]; then
        hint=" Миграция данных уже прошла — прежней версии может понадобиться база до неё: ./deploy/restore.sh --to-production ${BACKUP_KEY:-<KEY из --list>} --yes"
    fi
    die "$reason. Возвращена версия ${PREV_SHA:0:12}.$hint"
}

server_healthy() {
    local cid status
    cid="$(compose ps -q server 2> /dev/null || true)"
    [ -n "$cid" ] || return 1
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2> /dev/null || true)"
    [ "$status" = healthy ] && compose exec -T server wget -qO- http://127.0.0.1:3000/healthz > /dev/null 2>&1
}

restarts_of() { # "<status> <restart count>" of a service's container
    local cid
    cid="$(compose ps -q "$1" 2> /dev/null || true)"
    [ -n "$cid" ] || { echo "missing 0"; return 0; }
    docker inspect -f '{{.State.Status}} {{.RestartCount}}' "$cid" 2> /dev/null || echo "missing 0"
}

smoke() {
    local i=0 svc before="" after
    # UPDATE_SMOKE_TIMEOUT: seconds the new server gets to turn healthy.
    until server_healthy; do
        i=$((i + 5))
        [ "$i" -lt "${UPDATE_SMOKE_TIMEOUT:-300}" ] || return 1
        sleep 5
    done
    for svc in video-worker admin client pwa; do before="$before $svc=$(restarts_of "$svc" | tr ' ' :)"; done
    sleep 20
    for svc in video-worker admin client pwa; do
        after="$(restarts_of "$svc")"
        case "$after" in running*) ;; *) log "$svc: $after"; return 1 ;; esac
        case "$before" in *" $svc=$(printf '%s' "$after" | tr ' ' :)"*) ;; *) log "$svc перезапускается"; return 1 ;; esac
    done
    return 0
}

update() {
    local svc cid img pre post public
    cd "$CS_ROOT"
    if ! git diff --quiet || ! git diff --cached --quiet; then
        die "в $CS_ROOT есть незакоммиченные правки — git stash или git status"
    fi
    PREV_SHA="$(git rev-parse HEAD)"
    PREV_BRANCH="$(git symbolic-ref -q --short HEAD || true)"
    git fetch --quiet --tags origin
    if [ -n "$REF" ]; then
        TARGET="$(git rev-parse --verify -q "origin/$REF^{commit}" || git rev-parse --verify -q "$REF^{commit}")" \
            || die "не найдено: $REF"
    elif [ -n "$PREV_BRANCH" ]; then
        TARGET="$(git rev-parse "origin/$PREV_BRANCH")"
    else
        die "checkout не на ветке — укажите --ref"
    fi
    if [ "$TARGET" = "$PREV_SHA" ] && [ "$FORCE" = 0 ]; then
        log "уже на ${TARGET:0:12} — обновлять нечего (--force пересоберёт и перезапустит)"
        return 0
    fi
    log "обновление ${PREV_SHA:0:12} → ${TARGET:0:12}"
    git --no-pager log --oneline "$PREV_SHA..$TARGET" 2> /dev/null | head -n 20 || true

    # 1. code
    if [ -z "$REF" ]; then
        git merge -q --ff-only "$TARGET" || die "локальная ветка разошлась с origin — разберитесь вручную (git status)"
    else
        git checkout -q --detach "$TARGET"
    fi
    # From here on any failure — including one nobody anticipated (set -e,
    # set -u) — puts the previous version back.
    # shellcheck disable=SC2154 # rc is assigned inside the trap
    trap 'rc=$?; if [ "$rc" != 0 ] && [ -z "$ROLLED_BACK" ]; then rollback "непредвиденная ошибка (код $rc)"; fi' EXIT

    # New settings the template gained since the install (never overwrites).
    "$CS_ROOT/deploy/bootstrap.sh" --env-only || rollback "не удалось дополнить .env.production"

    # 2. images — the old containers keep serving meanwhile. One at a time:
    # two Next.js builds side by side do not fit in 8 GB.
    ROLLBACK_TAGGED=1
    for svc in $APP_SERVICES; do
        cid="$(compose ps -q "$svc" 2> /dev/null || true)"
        if [ -n "$cid" ]; then
            img="$(docker inspect -f '{{.Image}}' "$cid")"
            docker tag "$img" "$IMAGE_REPO/$svc:rollback"
        fi
    done
    for svc in $APP_SERVICES; do
        log "сборка ${svc}…"
        build_service "$svc" || rollback "сборка $svc не удалась"
    done

    # 3. backup
    if [ "$SKIP_BACKUP" = 0 ]; then
        "$CS_ROOT/deploy/backup-s3.sh" || rollback "бэкап перед обновлением не удался"
        BACKUP_KEY="$(cat "$CS_STATE_DIR/backup-s3.last-key" 2> /dev/null || true)"
        BACKUP_KEY="${BACKUP_KEY#*/db/}"
    else
        warn "бэкап пропущен (--skip-backup)"
    fi

    # 4. data migrations that must precede the schema push
    pre="$(needed_migrations pre)" || rollback "не удалось проверить состояние схемы"
    if [ -n "$pre" ]; then
        log "нужны миграции данных: $(printf '%s' "$pre" | tr '\n' ' ')— останавливаю приложения"
        SWITCHED=1
        compose stop server video-worker
        MIGRATED=1
        # shellcheck disable=SC2086 # file names without spaces
        run_migrations $pre || rollback "миграция данных не прошла"
    fi

    # 5. schema, then the switch
    log "prisma db push (новый образ)…"
    # shellcheck disable=SC2016 # expanded inside the container
    compose run --rm --no-deps -T --entrypoint sh server -c \
        './node_modules/.bin/prisma db push --schema=./prisma/schema.prisma --url "$DATABASE_URL"' \
        || rollback "prisma db push отказался применять схему (удаление данных?) — см. deploy/README.md, «A schema change refused to apply»"
    post="$(needed_migrations post)" || rollback "не удалось проверить состояние схемы"
    if [ -n "$post" ]; then
        MIGRATED=1
        # shellcheck disable=SC2086
        run_migrations $post || rollback "миграция данных не прошла"
    fi
    SWITCHED=1
    compose up -d --no-build || rollback "docker compose up не удался"
    # Bind-mounted config reaches a running container only when it restarts:
    # git writes a changed file anew, the container keeps reading the old one.
    # Only services that are running here (caddy is absent behind a proxy).
    local pair restart=""
    for pair in deploy/Caddyfile:caddy deploy/backup-db.sh:db-backup deploy/backup-media.sh:media-backup; do
        if ! git diff --quiet "$PREV_SHA" "$TARGET" -- "${pair%%:*}" && [ -n "$(compose ps -q "${pair#*:}" 2> /dev/null)" ]; then
            restart="$restart ${pair#*:}"
        fi
    done
    if [ -n "$restart" ]; then
        log "перезапуск с новой конфигурацией:$restart"
        # shellcheck disable=SC2086 # service names without spaces
        compose restart $restart || rollback "перезапуск$restart не удался"
    fi

    # 6. smoke
    log "жду готовности…"
    smoke || rollback "новая версия не поднялась (server /healthz или перезапуски контейнеров)"
    public="${HEALTH_API_URL:-https://api.$DOMAIN${PUBLIC_PORT_SUFFIX:-}}/healthz"
    curl -fsS -m 15 -o /dev/null "$public" || warn "$public снаружи не отвечает, хотя контейнер здоров — проверьте Caddy/DNS"

    docker image prune -f > /dev/null || true
    docker builder prune -f --filter until=168h > /dev/null 2>&1 || true
    log "ok: работает ${TARGET:0:12}"
    notify "Обновление выполнено" "$(git --no-pager log -1 --format='%h %s' "$TARGET")
Бэкап перед обновлением: ${BACKUP_KEY:-пропущен}"
}

load_env
ops_lock
# `exit` on the same line: git just replaced this very file, and bash reads a
# script as it goes — it must not read on into the new version's bytes.
run_or_alert "Обновление НЕ удалось" update; exit $?
