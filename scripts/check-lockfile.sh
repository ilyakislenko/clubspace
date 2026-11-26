#!/usr/bin/env bash
#
# Checks that package-lock.json installs with the npm inside the production
# Node image (node:22 ships npm 10). A lock written by a newer npm on a dev
# machine can omit entries npm 10 requires (e.g. packages under `overrides`),
# and then every Docker build stops at `npm ci` with «Missing: … from lock file».
#
# Usage:
#   bash scripts/check-lockfile.sh         # npm ci --dry-run in the image
#   bash scripts/check-lockfile.sh --fix   # rewrite the lock with the image's npm
#
# Needs Docker. Reads the base image from apps/server/Dockerfile so the check
# moves with the images.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"

IMAGE="$(grep -m1 -oE 'node:[0-9][^ ]*' apps/server/Dockerfile)"
[ -n "$IMAGE" ] || { echo "No node base image found in apps/server/Dockerfile" >&2; exit 2; }

MODE="check"
[ "${1:-}" = "--fix" ] && MODE="fix"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# The manifests the Docker deps stages copy: root + every workspace.
cp package.json package-lock.json "$WORK/"
[ -f .npmrc ] && cp .npmrc "$WORK/"
for manifest in apps/*/package.json libs/*/package.json; do
    mkdir -p "$WORK/$(dirname "$manifest")"
    cp "$manifest" "$WORK/$manifest"
done

if [ "$MODE" = "fix" ]; then
    docker run --rm -v "$WORK":/w -w /w "$IMAGE" \
        npm install --package-lock-only --ignore-scripts --no-audit --no-fund
    cp "$WORK/package-lock.json" "$ROOT/package-lock.json"
    echo "package-lock.json rewritten with the npm in $IMAGE"
else
    docker run --rm -v "$WORK":/w -w /w "$IMAGE" \
        npm ci --dry-run --ignore-scripts --no-audit --no-fund >/dev/null
    echo "package-lock.json installs with the npm in $IMAGE"
fi
