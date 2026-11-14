#!/usr/bin/env bash
#
# Admin smoke e2e (Playwright): signs in as owner / admin / head_coach / coach
# through the real UI and visits every route each role can see. How to run it
# and what it checks: TESTS.md, «Admin smoke e2e».
#
# Usage:
#   bash apps/admin-e2e/run.sh                 # whole suite
#   bash apps/admin-e2e/run.sh -g coach        # extra args go to `playwright test`
#
# Environment:
#   ADMIN_E2E_BASE_URL  admin origin   (default http://localhost:4200)
#   ADMIN_E2E_API_URL   API origin     (default http://localhost:3000)
#   ADMIN_E2E_NO_START=1  never build/start the admin; fail if it isn't up
#   DEMO_LOGIN_CODE     demo sign-in code (default: read from the repo .env)
#
# The API is NOT started here: it needs the demo clubs (DEMO_MODE=true, see
# docs/demo.md) and, because the session is an HttpOnly cookie that the API
# only issues to its own admin, ADMIN_URL=<admin origin> and the admin origin
# in CORS_ORIGINS.
#
# When nothing answers on the admin origin (and it is a localhost URL), the
# admin is built in production mode against ADMIN_E2E_API_URL (NEXT_PUBLIC_API_URL
# is baked into the bundle at build time) and started on that port for the
# duration of the run. The app uses `output: 'standalone'`, so the production
# server is `.next/standalone/.../server.js` — the same artifact the Docker
# image runs — not `next start`, which refuses standalone builds.
set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT="$PWD"

BASE_URL="${ADMIN_E2E_BASE_URL:-http://localhost:4200}"
API_URL="${ADMIN_E2E_API_URL:-http://localhost:3000}"
export ADMIN_E2E_BASE_URL="$BASE_URL" ADMIN_E2E_API_URL="$API_URL"

fail() { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }
step() { printf '\033[1;36m▶ %s\033[0m\n' "$1"; }

# --- API: must be the clubspace server --------------------------------------
# /healthz is clubspace's probe; another project's API on the same port answers
# 404 there, which would otherwise surface as a confusing sign-in failure.
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$API_URL/healthz" || true)"
[ "$code" = 200 ] || fail "API $API_URL/healthz answered '$code' — start the clubspace server (with DEMO_MODE=true, ADMIN_URL=$BASE_URL, CORS_ORIGINS including $BASE_URL)."

# --- admin: reuse, or build + start ------------------------------------------
ADMIN_PID=""
NEXT_ENV="apps/admin/next-env.d.ts"
NEXT_ENV_BACKUP=""
cleanup() {
    if [ -n "$ADMIN_PID" ]; then
        kill "$ADMIN_PID" 2>/dev/null || true
        wait "$ADMIN_PID" 2>/dev/null || true
    fi
    # Also on a failed build: `next build` rewrites next-env.d.ts early.
    if [ -n "$NEXT_ENV_BACKUP" ]; then
        cp "$NEXT_ENV_BACKUP" "$NEXT_ENV" && rm -f "$NEXT_ENV_BACKUP"
        NEXT_ENV_BACKUP=""
    fi
}
trap cleanup EXIT INT TERM

# The sign-in page server-renders the product name with «Админка»: anything
# else on the port is a different app.
is_our_admin() {
    curl -s --max-time 5 "$BASE_URL/sign-in" 2>/dev/null | grep -q 'Админка'
}

if is_our_admin; then
    step "Admin already running at $BASE_URL — reusing it (it must have been built with NEXT_PUBLIC_API_URL=$API_URL)"
elif curl -s -o /dev/null --max-time 5 "$BASE_URL/" 2>/dev/null; then
    fail "$BASE_URL answers but is not the clubspace admin — pick another port via ADMIN_E2E_BASE_URL."
elif [ "${ADMIN_E2E_NO_START:-0}" = 1 ]; then
    fail "Admin not reachable at $BASE_URL (ADMIN_E2E_NO_START=1)."
else
    case "$BASE_URL" in
        http://localhost:*|http://127.0.0.1:*) ;;
        *) fail "Admin not reachable at $BASE_URL and it is not a localhost URL — start it yourself." ;;
    esac
    PORT="${BASE_URL##*:}"; PORT="${PORT%%/*}"

    step "Building the admin (production) against $API_URL"
    # `next build` rewrites the committed next-env.d.ts (dev vs build type
    # paths); cleanup() puts it back, on success or failure.
    NEXT_ENV_BACKUP="$(mktemp)"
    cp "$NEXT_ENV" "$NEXT_ENV_BACKUP"
    # --skip-nx-cache: NEXT_PUBLIC_API_URL is not an nx input, so a cached
    # build for another API URL would be replayed.
    NEXT_PUBLIC_API_URL="$API_URL" NEXT_TELEMETRY_DISABLED=1 \
        npx nx build @clubspace/admin --skip-sync --skip-nx-cache --output-style=stream
    cp "$NEXT_ENV_BACKUP" "$NEXT_ENV"; rm -f "$NEXT_ENV_BACKUP"; NEXT_ENV_BACKUP=""

    # A private copy: dist/apps/admin is shared with anyone else building the
    # admin, and the server reads pages from disk lazily.
    SERVE_DIR="$ROOT/dist/admin-e2e/$PORT"
    rm -rf "$SERVE_DIR"; mkdir -p "$SERVE_DIR"
    cp -R dist/apps/admin/.next/standalone/. "$SERVE_DIR/"
    mkdir -p "$SERVE_DIR/dist/apps/admin/.next" "$SERVE_DIR/apps/admin"
    cp -R dist/apps/admin/.next/static "$SERVE_DIR/dist/apps/admin/.next/static"
    cp -R apps/admin/public "$SERVE_DIR/apps/admin/public"

    # The page CSP is built per request from S3_UPLOAD_BUCKET_URL /
    # S3_ACCELERATE_URL (src/shared/lib/content-security-policy.ts): without
    # them every thumbnail and video segment is blocked. Same values as the
    # API's, from the environment or the repo .env.
    dotenv_value() { [ -f .env ] && grep -E "^$1=" .env | tail -1 | cut -d= -f2- || true; }
    S3_UPLOAD_BUCKET_URL="${S3_UPLOAD_BUCKET_URL:-$(dotenv_value S3_UPLOAD_BUCKET_URL)}"
    S3_ACCELERATE_URL="${S3_ACCELERATE_URL:-$(dotenv_value S3_ACCELERATE_URL)}"

    step "Starting the admin on port $PORT"
    (cd "$SERVE_DIR" && PORT="$PORT" HOSTNAME=localhost NODE_ENV=production \
        NEXT_TELEMETRY_DISABLED=1 S3_UPLOAD_BUCKET_URL="$S3_UPLOAD_BUCKET_URL" \
        S3_ACCELERATE_URL="$S3_ACCELERATE_URL" exec node apps/admin/server.js) &
    ADMIN_PID=$!
    for _ in $(seq 1 60); do
        is_our_admin && break
        kill -0 "$ADMIN_PID" 2>/dev/null || fail "admin server exited during startup"
        sleep 1
    done
    is_our_admin || fail "admin did not come up on $BASE_URL within 60s"
fi

step "Running the admin smoke suite ($BASE_URL → $API_URL)"
npx playwright test -c apps/admin-e2e/playwright.config.ts "$@"
