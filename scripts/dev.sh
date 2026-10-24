#!/usr/bin/env bash
#
# One command to bring up the whole local stack for testing:
#   infra (docker) → schema (prisma) → API + admin + video-worker + mobile (Expo)
#
# Usage:  npm run dev        (or: bash scripts/dev.sh)
# Stop:   Ctrl-C             (kills every process it started)
#
# Assumes default ports are free (postgres 5432, api 3000, admin 4200, minio
# 9000/9001, maildev 1080). If another local stack holds those, stop it first.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

INFRA_SERVICES="postgres redis minio minio-init maildev"

fail() { printf '\n\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }
step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$1"; }

command -v docker >/dev/null 2>&1 || fail "Docker не найден. Установи / запусти Docker Desktop."
docker info >/dev/null 2>&1 || fail "Docker daemon не отвечает. Запусти Docker Desktop и повтори."

step "1/4  Инфраструктура (postgres, redis, minio, maildev)…"
docker compose up -d $INFRA_SERVICES

step "2/4  Жду готовности Postgres…"
for i in $(seq 1 60); do
  if docker compose exec -T postgres pg_isready -U postgres -d clubspace >/dev/null 2>&1; then
    printf '   Postgres готов.\n'
    break
  fi
  [ "$i" -eq 60 ] && fail "Postgres не поднялся за 60с."
  sleep 1
done

step "3/4  Схема (prisma db push + generate)…"
npx nx run @clubspace/server:prisma:prepare

step "4/4  Поднимаю приложения…"
cat <<'URLS'

  ┌─ URLs ───────────────────────────────────────────────────────┐
  │  API        http://localhost:3000   (docs /api · health /healthz)
  │  Админка    http://localhost:4200
  │  Maildev    http://localhost:1080   (письма / OTP-коды входа)
  │  MinIO      http://localhost:9001   (console: minioadmin/minioadmin)
  │  Mobile     Expo Metro — в панели [app] нажми  i  (iOS-симулятор)
  │             или отсканируй QR в Expo Go
  └──────────────────────────────────────────────────────────────┘
  Вход в админку: SUPER_ADMIN_EMAIL из .env (по умолчанию superadmin@localhost.invalid).
  Пароля нет — код придёт на почту, забери его в Maildev (:1080).
  Клубов на чистой базе нет: создай первый в консоли /platform.
  Ctrl-C гасит всё.

URLS

# One multiplexed terminal: prefixed, colored logs; keystrokes (i / r) go to the
# Expo process so you can open the iOS sim without a second terminal. -k kills the
# whole group when any process exits or on Ctrl-C.
exec npx concurrently \
  --kill-others \
  --handle-input --default-input-target 3 \
  --names "api,web,worker,app" \
  --prefix-colors "blue,green,magenta,yellow" \
  "npx nx serve @clubspace/server" \
  "npx nx serve @clubspace/admin" \
  "npx nx serve @clubspace/video-worker" \
  "npx nx start @clubspace/mobile"
