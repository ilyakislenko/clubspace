#!/usr/bin/env bash
# Points the Android build profiles at a deployed install.
#
#   ./scripts/set-mobile-target.sh --domain club.example.com --club-key my_club \
#       --support-email help@club.example.com
#
# Run on the machine that builds the APK — EAS needs Node and an Expo login,
# neither of which the server has.
set -euo pipefail

cd "$(dirname "$0")/.."

DOMAIN=""; CLUB_KEY=""; SUPPORT_EMAIL=""; PUBLIC_PORT=""; DRY_RUN=0
fail() { printf '\n\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

while [ $# -gt 0 ]; do
    case "$1" in
        --domain) DOMAIN="${2:-}"; shift 2 ;;
        --club-key) CLUB_KEY="${2:-}"; shift 2 ;;
        --support-email) SUPPORT_EMAIL="${2:-}"; shift 2 ;;
        --public-port) PUBLIC_PORT="${2:-}"; shift 2 ;;
        --dry-run) DRY_RUN=1; shift ;;
        -h|--help)
            printf 'Usage: %s --domain <domain> --club-key <key> --support-email <email> [--public-port <port>] [--dry-run]\n' "$0"; exit 0 ;;
        *) fail "Unknown argument: $1" ;;
    esac
done

[ -n "$DOMAIN" ] || fail "--domain is required"
[ -n "$CLUB_KEY" ] || fail "--club-key is required"
[ -n "$SUPPORT_EMAIL" ] || fail "--support-email is required"
printf '%s' "$SUPPORT_EMAIL" | grep -Eq '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' \
    || fail "--support-email must be an email address, got: $SUPPORT_EMAIL"
printf '%s' "$CLUB_KEY" | grep -Eq '^[a-z0-9_-]{2,50}$' \
    || fail "--club-key must match [a-z0-9_-]{2,50}, got: $CLUB_KEY"
if [ -n "$PUBLIC_PORT" ] && [ "$PUBLIC_PORT" != "443" ]; then
    printf '%s' "$PUBLIC_PORT" | grep -Eq '^[0-9]{2,5}$' || fail "--public-port must be a number, got: $PUBLIC_PORT"
    API_ORIGIN="https://api.$DOMAIN:$PUBLIC_PORT"
    WEB_ORIGIN="https://app.$DOMAIN:$PUBLIC_PORT"
else
    API_ORIGIN="https://api.$DOMAIN"
    WEB_ORIGIN="https://app.$DOMAIN"
fi
command -v node >/dev/null 2>&1 || fail "node не найден — запусти это на машине разработчика"

API_ORIGIN="$API_ORIGIN" WEB_ORIGIN="$WEB_ORIGIN" SUPPORT_EMAIL="$SUPPORT_EMAIL" CLUB_KEY="$CLUB_KEY" DRY_RUN="$DRY_RUN" node <<'NODE'
const fs = require("fs")
const path = "apps/mobile/eas.json"
const { API_ORIGIN, WEB_ORIGIN, SUPPORT_EMAIL, CLUB_KEY, DRY_RUN } = process.env

const eas = JSON.parse(fs.readFileSync(path, "utf8"))
// Both distribution profiles, so a preview build behaves exactly like what a
// student receives. Expo inlines these at bundle time and they override
// app.json's `extra`, which stays a dev-only fallback.
for (const profile of ["preview", "production"]) {
    const target = eas.build[profile]
    if (!target) throw new Error(`eas.json has no build.${profile} profile`)
    target.env = {
        ...target.env,
        EXPO_PUBLIC_API_URL: API_ORIGIN,
        EXPO_PUBLIC_WORKSPACE_KEY: CLUB_KEY,
        EXPO_PUBLIC_WEB_URL: WEB_ORIGIN,
        EXPO_PUBLIC_SUPPORT_EMAIL: SUPPORT_EMAIL,
    }
}

const out = JSON.stringify(eas, null, 2) + "\n"
if (DRY_RUN === "1") {
    process.stdout.write(out)
} else {
    fs.writeFileSync(path, out)
    console.log(`✓ ${path}: ${API_ORIGIN} · клуб ${CLUB_KEY}`)
    console.log("  Дальше (apps/mobile):")
    console.log("    APK для раздачи:   npx eas build --profile production --platform android")
    console.log("    AAB для Google Play: npx eas build --profile store --platform android")
    console.log("    Отправка в Play:   npx eas submit --profile store --platform android")
}
NODE
