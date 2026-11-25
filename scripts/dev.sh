#!/usr/bin/env bash
#
# One command to bring up the whole local stack for testing:
#   infra (docker) → schema (prisma) → API + admin + video-worker + mobile (Expo)
#
# Usage:  npm run dev        (or: bash scripts/dev.sh)
# Stop:   Ctrl-C             (kills every process it started)
#
# Ports: API 3000, admin 4200, Expo Metro 8081 by default. When another project
# already holds them, pick free ones — every URL and process follows:
#   SERVER_PORT=3201 ADMIN_PORT=4401 npm run dev        (METRO_PORT=8091 for Expo)
# The ports are checked before anything starts; a busy one stops the script
# with the process holding it. Infra (postgres 5432, redis 6379, minio
# 9000/9001, maildev 1080) is docker's and keeps its fixed ports.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT"

INFRA_SERVICES="postgres redis minio minio-init maildev"

fail() { printf '\n\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }
step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$1"; }

SERVER_PORT="${SERVER_PORT:-3000}"
ADMIN_PORT="${ADMIN_PORT:-4200}"
METRO_PORT="${METRO_PORT:-8081}"
for var in SERVER_PORT ADMIN_PORT METRO_PORT; do
  case "${!var}" in
    '' | *[!0-9]*) fail "$var=${!var} — укажите номер порта, например $var=3201." ;;
  esac
done
# The API reads SERVER_PORT itself; exported beats the value in .env.
export SERVER_PORT

# ── Port check: before docker or any server starts ──────────────────────────
# Prints "pid command" of the process listening on the port (empty when free
# or when it belongs to another user and lsof can't see it).
port_holder() {
  lsof +c 0 -nP -iTCP:"$1" -sTCP:LISTEN -Fpc 2>/dev/null |
    awk '/^p/ { pid = substr($0, 2) } /^c/ { print pid, substr($0, 2); exit }'
}
port_busy() {
  [ -n "$(port_holder "$1")" ] || nc -z 127.0.0.1 "$1" >/dev/null 2>&1
}
# First free port from $1 upwards in steps of 10 (3201, 3211, …).
free_port() {
  local port="$1"
  while port_busy "$port"; do port=$((port + 10)); done
  printf '%s' "$port"
}
describe_holder() {
  local port="$1" holder pid cmd cwd
  # `|| true`: awk/head stop reading early, and under pipefail the SIGPIPE'd
  # lsof would abort the script (set -e) before the message is printed.
  holder="$(port_holder "$port" || true)"
  if [ -z "$holder" ]; then
    printf '   порт %s занят процессом другого пользователя (lsof его не видит)\n' "$port" >&2
    return
  fi
  pid="${holder%% *}"
  cmd="${holder#* }"
  cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1 || true)"
  printf '   порт %s держит: %s (pid %s), папка: %s\n' "$port" "$cmd" "$pid" "${cwd:-не удалось определить}" >&2
  case "$cwd/" in
    "$ROOT"/*) printf '   → это уже запущенный стек этого репозитория — остановите его (Ctrl-C в его терминале).\n' >&2 ;;
    /?*) printf '   → это не этот репозиторий — не трогайте его, запустите ClubSpace на других портах.\n' >&2 ;;
  esac
}

conflicts=""
suggest=""
for var in SERVER_PORT ADMIN_PORT METRO_PORT; do
  port="${!var}"
  case "$var" in
    SERVER_PORT) default=3000 alt=3201 ;;
    ADMIN_PORT) default=4200 alt=4401 ;;
    METRO_PORT) default=8081 alt=8091 ;;
  esac
  if port_busy "$port"; then
    conflicts="$conflicts $var"
    suggest="$suggest $var=$(free_port "$alt")"
  elif [ "$port" != "$default" ]; then
    suggest="$suggest $var=$port"
  fi
done
if [ -n "$conflicts" ]; then
  printf '\n\033[31m✗ Порты заняты — стек не запускаю.\033[0m\n' >&2
  for var in $conflicts; do
    printf '\n %s=%s:\n' "$var" "${!var}" >&2
    describe_holder "${!var}"
  done
  printf '\n Запустите стек на свободных портах (все адреса подстроятся сами):\n' >&2
  printf '   \033[1m%s npm run dev\033[0m\n' "${suggest# }" >&2
  printf ' Проверка перед демо — с теми же переменными:\n' >&2
  printf '   %s bash scripts/demo-preflight.sh\n\n' "${suggest# }" >&2
  exit 1
fi

command -v docker >/dev/null 2>&1 || fail "Docker не найден. Установи / запусти Docker Desktop."
docker info >/dev/null 2>&1 || fail "Docker daemon не отвечает. Запусти Docker Desktop и повтори."

# Phones and tablets on the same Wi-Fi reach the stack by the Mac's LAN IP, so
# every URL the server hands out (HLS manifests, storage links) and the app's
# API address must use it — with `localhost` the video never loads on a device.
# Falls back to localhost when offline. Exported values beat .env (nx loads it
# without overriding), and .env.example ships localhost for these two, so they
# are always derived here; pin them with ROOT_URL_OVERRIDE /
# S3_UPLOAD_BUCKET_URL_OVERRIDE. The rest keep a value already exported. The
# admin is opened on the Mac itself, so its address and the API address baked
# into it stay on localhost.
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || true)"
HOST="${LAN_IP:-localhost}"
export ROOT_URL="${ROOT_URL_OVERRIDE:-http://$HOST:$SERVER_PORT}"
export S3_UPLOAD_BUCKET_URL="${S3_UPLOAD_BUCKET_URL_OVERRIDE:-http://$HOST:9000}"
export EXPO_PUBLIC_API_URL="${EXPO_PUBLIC_API_URL:-http://$HOST:$SERVER_PORT}"
export ADMIN_URL="${ADMIN_URL:-http://localhost:$ADMIN_PORT}"
export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://localhost:$SERVER_PORT}"
export CORS_ORIGINS="${CORS_ORIGINS:-http://localhost:$SERVER_PORT,http://localhost:$ADMIN_PORT,http://localhost:4201,http://$HOST:$SERVER_PORT,http://$HOST:$ADMIN_PORT,http://$HOST:4201}"

step "1/4  Инфраструктура (postgres, redis, minio, maildev)…"
# shellcheck disable=SC2086 # a list of service names: split on purpose
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
cat <<URLS

  ┌─ URLs ───────────────────────────────────────────────────────┐
  │  API        http://localhost:$SERVER_PORT   (docs /api · health /healthz)
  │  Админка    http://localhost:$ADMIN_PORT
  │  Maildev    http://localhost:1080   (письма / OTP-коды входа)
  │  MinIO      http://localhost:9001   (console: minioadmin/minioadmin)
  │  Mobile     Expo Metro :$METRO_PORT — в панели [app] нажми  i  (iOS-симулятор)
  │             или отсканируй QR в Expo Go
  ├─ С телефона / планшета в той же Wi-Fi ───────────────────────┤
  │  API        $ROOT_URL
  │  Видео      $S3_UPLOAD_BUCKET_URL
  └──────────────────────────────────────────────────────────────┘
  Вход в админку: SUPER_ADMIN_EMAIL из .env (по умолчанию superadmin@localhost.invalid).
  Пароля нет — код придёт на почту, забери его в Maildev (:1080).
  Клубов на чистой базе нет: создай первый в консоли /platform.
  Ctrl-C гасит всё.

URLS

# One multiplexed terminal: prefixed, colored logs; keystrokes (i / r) go to the
# Expo process so you can open the iOS sim without a second terminal. -k kills the
# whole group when any process exits or on Ctrl-C. Metro's port is passed
# explicitly: the nx expo executor would otherwise default to 19000.
exec npx concurrently \
  --kill-others \
  --handle-input --default-input-target 3 \
  --names "api,web,worker,app" \
  --prefix-colors "blue,green,magenta,yellow" \
  "npx nx serve @clubspace/server" \
  "npx nx serve @clubspace/admin --port=$ADMIN_PORT" \
  "npx nx serve @clubspace/video-worker" \
  "npx nx start @clubspace/mobile --port=$METRO_PORT"
