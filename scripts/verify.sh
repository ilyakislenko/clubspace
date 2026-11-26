#!/usr/bin/env bash
#
# One command that answers "is this branch safe to merge?".
#
# It exists because GitHub Actions has been unavailable since 2026-07-07 (the
# free-plan minutes ran out), so the pipeline in .github/workflows/ci.yml never
# runs. Everything that gates a merge has to be reproducible on a laptop, and
# it has to be ONE command — a checklist nobody can run in a single step is a
# checklist that gets skipped.
#
# Deliberately does NOT stop at the first failure: the point is to learn
# everything that is broken in one pass instead of rediscovering it one
# `npm run verify` at a time. Pass --fail-fast to stop early.
#
# Usage:
#   npm run verify                # typecheck + unit/UI + e2e + contract + lint
#   npm run verify -- --quick     # skip lint and e2e, for a fast inner loop
#   npm run verify -- --fail-fast
#   VERIFY_DOCKER=1 npm run verify  # also build every prod image + npm audit
#   VERIFY_ADMIN_E2E=1 npm run verify  # also the admin smoke e2e (Playwright)
#
# The e2e step boots the real server against a real Postgres and Redis, so it
# needs the local stack up (`npm run dev:infra`). It is skipped with a loud
# warning rather than silently passing when they are unreachable — a green tick
# for a suite that never ran is worse than a red one.
#
# The admin smoke e2e (apps/admin-e2e/run.sh) needs a running API with the demo
# clubs; it builds and starts the admin itself. ADMIN_E2E_BASE_URL /
# ADMIN_E2E_API_URL pick the origins (default :4200 / :3000) — see TESTS.md.
set -uo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"

FAIL_FAST=0
QUICK=0
for arg in "$@"; do
    case "$arg" in
        --fail-fast) FAIL_FAST=1 ;;
        --quick) QUICK=1 ;;
        -h|--help) sed -n '2,29p' "$0" | sed 's|^# \{0,1\}||'; exit 0 ;;
        *) echo "unknown flag: $arg" >&2; exit 2 ;;
    esac
done

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BOLD=$'\033[1m'; OFF=$'\033[0m'
STEP_NAMES=()
STEP_RESULTS=()
FAILED=0

run_step() {
    local name="$1"; shift
    printf '\n%s▶ %s%s\n' "$BOLD" "$name" "$OFF"
    if "$@"; then
        STEP_NAMES+=("$name"); STEP_RESULTS+=("ok")
        printf '%s✓ %s%s\n' "$GREEN" "$name" "$OFF"
    else
        STEP_NAMES+=("$name"); STEP_RESULTS+=("FAIL")
        FAILED=1
        printf '%s✗ %s%s\n' "$RED" "$name" "$OFF"
        if [ "$FAIL_FAST" = 1 ]; then
            summary
            exit 1
        fi
    fi
}

summary() {
    printf '\n%s─── verify summary ───%s\n' "$BOLD" "$OFF"
    local i
    for i in "${!STEP_NAMES[@]}"; do
        if [ "${STEP_RESULTS[$i]}" = "ok" ]; then
            printf '  %s✓%s %s\n' "$GREEN" "$OFF" "${STEP_NAMES[$i]}"
        else
            printf '  %s✗%s %s\n' "$RED" "$OFF" "${STEP_NAMES[$i]}"
        fi
    done
}

# --- prerequisites -----------------------------------------------------------
# The prisma client and the referenced lib .d.ts files are gitignored build
# output. tsc resolves project references against them, so a fresh clone
# typechecks against nothing and reports a confusing wall of missing modules.
prepare() {
    if [ ! -d "apps/server/src/infrastructure/prisma/generated" ]; then
        echo "prisma client missing — generating"
        npx prisma generate --schema=apps/server/prisma/schema.prisma || return 1
    fi
    npx nx run-many -t build -p @clubspace/api-client,@clubspace/prisma-client \
        --skip-sync --output-style=stream
}

# --- typecheck ---------------------------------------------------------------
# tsc directly, not `nx typecheck`: the nx target is gated on the workspace
# sync check, which fails for unrelated reasons and hides real type errors.
# Note the per-app tsconfig — apps/mobile/tsconfig.json checks NOTHING and
# reports clean no matter how broken the code is.
typecheck() {
    local ok=0
    local projects=(
        "server apps/server tsconfig.app.json"
        "admin apps/admin tsconfig.json"
        "client apps/client tsconfig.json"
        "mobile apps/mobile tsconfig.app.json"
        "video-worker apps/video-worker tsconfig.app.json"
        "server-e2e apps/server-e2e tsconfig.json"
    )
    for entry in "${projects[@]}"; do
        # shellcheck disable=SC2086
        set -- $entry
        printf '  · %s\n' "$1"
        if ! (cd "$ROOT/$2" && npx tsc --noEmit -p "$3"); then
            printf '    %s^ %s failed typecheck%s\n' "$RED" "$1" "$OFF"
            ok=1
        fi
    done
    return $ok
}

# --- contract drift ----------------------------------------------------------
# open-api.json, the generated API types and the theme CSS are all committed
# build products consumed by three frontends. If a DTO changes and these aren't
# regenerated, the frontends compile against a contract the server no longer
# serves — which typechecks clean and breaks at runtime.
contract() {
    local ok=0
    npx nx open-api:generate @clubspace/server --skip-sync >/dev/null || return 1
    git diff --exit-code --quiet -- open-api.json || {
        printf '  %sopen-api.json drifted — commit the regenerated spec%s\n' "$RED" "$OFF"; ok=1; }
    npx nx types:generate @clubspace/api-client --skip-sync >/dev/null || return 1
    git diff --exit-code --quiet -- libs/api-client/src/openapi || {
        printf '  %sapi-client types drifted — commit them%s\n' "$RED" "$OFF"; ok=1; }
    npm run theme:generate --silent >/dev/null || return 1
    git diff --exit-code --quiet -- libs/ui-kit/util/globals.css || {
        printf '  %sglobals.css drifted — run npm run theme:generate%s\n' "$RED" "$OFF"; ok=1; }
    return $ok
}

# --- tests -------------------------------------------------------------------
# --coverage is not decoration: the jest configs carry coverageThreshold
# ratchets, so this is where "a new file arrived with no test" fails the build.
unit_tests() {
    npx nx run-many -t test \
        --projects=@clubspace/server,@clubspace/admin,@clubspace/mobile,@clubspace/video-worker,@clubspace/api-client,@clubspace/client \
        --coverage --skip-sync --output-style=stream
}

# --- release (opt-in: VERIFY_DOCKER=1) ---------------------------------------
# Mirrors the `docker` and `audit` CI jobs. Off by default: five image builds
# take minutes, and the inner loop shouldn't pay for them.
DOCKER_IMAGES=(
    "server apps/server/Dockerfile"
    "video-worker apps/video-worker/Dockerfile"
    "admin apps/admin/Dockerfile"
    "client apps/client/Dockerfile"
    "pwa apps/mobile/Dockerfile"
)
docker_images() {
    local ok=0 entry
    for entry in "${DOCKER_IMAGES[@]}"; do
        # shellcheck disable=SC2086
        set -- $entry
        printf '  · %s\n' "$1"
        if ! docker build -q -f "$2" -t "clubspace-verify/$1" \
            --build-arg NEXT_PUBLIC_API_URL=https://api.example.com \
            --build-arg EXPO_PUBLIC_API_URL=https://api.example.com \
            --build-arg EXPO_PUBLIC_WEB_URL=https://app.example.com \
            . >/dev/null; then
            printf '    %s^ %s image failed to build%s\n' "$RED" "$1" "$OFF"
            ok=1
        fi
    done
    return $ok
}

# Advisory, like the CI job: reported, never fails verify (yet).
npm_audit() {
    npm audit --omit=dev --audit-level=high || \
        printf '%s⚠ npm audit found high/critical advisories (non-blocking)%s\n' "$YELLOW" "$OFF"
    return 0
}

lint() {
    npx nx run-many -t lint --skip-sync --output-style=stream
}

# Boots the whole AppModule in-process against the real database, so it catches
# what mocks cannot: guards that never fire, a serializer dropping a field, the
# global error filter rewriting a response body.
#
# Through `npm run test:e2e`, not nx directly: that script carries the heap
# ceiling (NODE_OPTIONS) for the jest worker, so verify, CI and a hand run all
# get the same one and nobody has to export it first.
e2e_tests() {
    npm run test:e2e --silent -- --skip-sync --output-style=stream
}

# Probes exactly what the e2e suite will connect to (apps/server-e2e/src/support/env.ts):
# E2E_DATABASE_URL and E2E_REDIS_HOST/E2E_REDIS_PORT, falling back to the same
# localhost:5432 / localhost:6379 defaults. Probing fixed ports would skip (or run)
# the suite based on servers it never talks to.
e2e_targets() {
    node -e '
        const db = new URL(process.env.E2E_DATABASE_URL || "postgres://localhost:5432/clubspace_e2e")
        const redisHost = process.env.E2E_REDIS_HOST || "localhost"
        const redisPort = process.env.E2E_REDIS_PORT || "6379"
        console.log(`${db.hostname}:${db.port || 5432} ${redisHost}:${redisPort}`)
    '
}

infra_reachable() {
    node -e '
        const net = require("net")
        const probe = (target) => new Promise((resolve) => {
            const [host, port] = target.split(":")
            const s = net.connect({ host, port: Number(port) })
            s.setTimeout(1500)
            s.once("connect", () => { s.destroy(); resolve(true) })
            s.once("error", () => resolve(false))
            s.once("timeout", () => { s.destroy(); resolve(false) })
        })
        Promise.all(process.argv.slice(1).map(probe)).then((results) => {
            process.exit(results.every(Boolean) ? 0 : 1)
        })
    ' $(e2e_targets) 2>/dev/null
}

# --- run ---------------------------------------------------------------------
run_step "prepare (prisma client + referenced libs)" prepare
run_step "typecheck (6 projects)" typecheck
run_step "unit + UI tests (coverage-gated)" unit_tests
run_step "contract (open-api / api types / theme css)" contract
# Seconds, and it catches a lock the Docker images can't `npm ci` (written by
# a newer npm than the one in node:22). Skipped without a Docker daemon.
if docker info >/dev/null 2>&1; then
    run_step "lockfile (npm ci in the prod node image)" bash scripts/check-lockfile.sh
fi
if [ "$QUICK" = 0 ]; then
    if infra_reachable; then
        run_step "e2e (real server + real database)" e2e_tests
    else
        SKIPPED_E2E=1
        printf '\n%s⚠ e2e SKIPPED — Postgres or Redis unreachable (%s).%s\n' "$YELLOW" "$(e2e_targets)" "$OFF"
        printf '%s  Run `npm run dev:infra`, then verify again before merging.%s\n' "$YELLOW" "$OFF"
    fi
    run_step "lint" lint
else
    printf '\n%s⏭ lint and e2e skipped (--quick)%s\n' "$YELLOW" "$OFF"
fi
if [ "${VERIFY_DOCKER:-0}" = 1 ]; then
    run_step "docker images (5, no push)" docker_images
    run_step "npm audit --omit=dev (advisory)" npm_audit
fi
# Opt-in: needs a running API with the demo clubs (not part of the default
# stack check), and builds the admin in production mode, which takes minutes.
if [ "${VERIFY_ADMIN_E2E:-0}" = 1 ]; then
    run_step "admin smoke e2e (4 roles, Playwright)" bash apps/admin-e2e/run.sh
fi
summary
if [ "$FAILED" = 1 ]; then
    printf '\n%s✗ verify failed — do not merge%s\n' "$RED" "$OFF"
    exit 1
fi
if [ "${SKIPPED_E2E:-0}" = 1 ]; then
    printf '\n%s⚠ verify passed, but the e2e suite never ran — this is not a full check%s\n' "$YELLOW" "$OFF"
    exit 0
fi
printf '\n%s✓ verify passed%s\n' "$GREEN" "$OFF"
