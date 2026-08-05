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
#   npm run verify                # typecheck + lint + unit/UI tests + contract
#   npm run verify -- --quick     # skip lint (the slowest step) for a fast loop
#   npm run verify -- --fail-fast
#
# No e2e step yet on purpose: apps/server-e2e is still the untouched Nx
# scaffold asserting that GET /api returns "Hello API". Wiring it in here would
# add a step that reports green while testing nothing, which is the exact
# failure mode this script exists to prevent.
set -uo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"

FAIL_FAST=0
QUICK=0
for arg in "$@"; do
    case "$arg" in
        --fail-fast) FAIL_FAST=1 ;;
        --quick) QUICK=1 ;;
        -h|--help) sed -n '2,26p' "$0" | sed 's|^# \{0,1\}||'; exit 0 ;;
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
        --projects=@clubspace/server,@clubspace/admin,@clubspace/mobile \
        --coverage --skip-sync --output-style=stream
}

lint() {
    npx nx run-many -t lint --skip-sync --output-style=stream
}

# --- run ---------------------------------------------------------------------
run_step "prepare (prisma client + referenced libs)" prepare
run_step "typecheck (5 projects)" typecheck
run_step "unit + UI tests (coverage-gated)" unit_tests
run_step "contract (open-api / api types / theme css)" contract
if [ "$QUICK" = 0 ]; then
    run_step "lint" lint
else
    printf '\n%s⏭ lint skipped (--quick)%s\n' "$YELLOW" "$OFF"
fi
summary
if [ "$FAILED" = 1 ]; then
    printf '\n%s✗ verify failed — do not merge%s\n' "$RED" "$OFF"
    exit 1
fi
printf '\n%s✓ verify passed%s\n' "$GREEN" "$OFF"
