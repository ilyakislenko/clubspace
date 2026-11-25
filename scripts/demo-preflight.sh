#!/usr/bin/env bash
# Pre-flight check before demoing the app on the road.
# Verifies that all moving parts (server, admin, emulator, MinIO, MailDev)
# talk to each other through 127.0.0.1, so the demo works regardless of the
# Wi-Fi/hotspot the Mac is on.
#
# Usage:  bash scripts/demo-preflight.sh
# Stack started on other ports (SERVER_PORT=3201 ADMIN_PORT=4401 npm run dev)?
# Pass the same variables:  SERVER_PORT=3201 ADMIN_PORT=4401 bash scripts/demo-preflight.sh

set -u
cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd -P)"

SERVER_PORT="${SERVER_PORT:-3000}"
ADMIN_PORT="${ADMIN_PORT:-4200}"
METRO_PORT="${METRO_PORT:-8081}"

red() { printf "\033[31m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }

ok=0
fail=0
foreign=""

check() {
  local label="$1"
  local cmd="$2"
  if eval "$cmd" >/dev/null 2>&1; then
    green "  ✔ $label"
    ok=$((ok + 1))
  else
    red "  ✘ $label"
    fail=$((fail + 1))
  fi
}

# Other checkouts of this repo (git worktrees) run the same ClubSpace stack.
WORKTREES="$(git worktree list --porcelain 2>/dev/null | sed -n 's/^worktree //p')"

# "pid command" of the process listening on the port; empty when nobody does
# or the holder belongs to another user (lsof can't see it).
port_holder() {
  lsof +c 0 -nP -iTCP:"$1" -sTCP:LISTEN -Fpc 2>/dev/null |
    awk '/^p/ { pid = substr($0, 2) } /^c/ { print pid, substr($0, 2); exit }'
}
pid_cwd() {
  lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1
}
# ours | worktree:<path> | foreign | unknown — by the holder's working folder.
classify_cwd() {
  local cwd="$1" wt
  [ -n "$cwd" ] || { echo unknown; return; }
  case "$cwd/" in "$ROOT"/*) echo ours; return ;; esac
  while IFS= read -r wt; do
    [ -n "$wt" ] || continue
    case "$cwd/" in "$wt"/*) echo "worktree:$wt"; return ;; esac
  done <<< "$WORKTREES"
  echo foreign
}

# Looks up who listens on the port: sets H_PID, H_CMD, H_CWD and H_KIND
# (ours | worktree:<path> | foreign | unknown | free | hidden).
inspect_port() {
  local holder
  H_PID="" H_CMD="" H_CWD=""
  holder="$(port_holder "$1")"
  if [ -z "$holder" ]; then
    # Nobody, or a process of another user that lsof can't see.
    if nc -z 127.0.0.1 "$1" >/dev/null 2>&1; then H_KIND=hidden; else H_KIND=free; fi
    return
  fi
  H_PID="${holder%% *}"
  H_CMD="${holder#* }"
  H_CWD="$(pid_cwd "$H_PID")"
  H_KIND="$(classify_cwd "$H_CWD")"
}

# Explains the holder inspect_port found for port $1.
print_holder() {
  local port="$1" who="порт $1 держит: $H_CMD (pid $H_PID), папка: ${H_CWD:-не удалось определить}"
  case "$H_KIND" in
    free) yellow "    на порту $port никто не слушает — стек не запущен (npm run dev)" ;;
    hidden) yellow "    порт $port занят процессом другого пользователя (lsof его не видит)" ;;
    ours)
      yellow "    $who"
      yellow "    → это этот репозиторий, но отвечает не так, как ожидается (ещё стартует? посмотрите лог npm run dev)"
      ;;
    worktree:*)
      yellow "    $who"
      yellow "    → это ClubSpace из другой копии репозитория (${H_KIND#worktree:}), не из $ROOT"
      ;;
    elsewhere)
      yellow "    $who"
      yellow "    → отвечает как ClubSpace API, но запущен не из $ROOT"
      ;;
    foreign)
      red "    $who"
      red "    → это другой проект, не ClubSpace"
      ;;
    *) yellow "    $who" ;;
  esac
}

# A port check that also tells who holds the port: $1 label, $2 port, $3 probe,
# $4 = 1 when the probe identifies ClubSpace itself (then it outranks the
# holder's folder). Explains the holder when the check fails or the holder is
# not this repo; another project on the port fails the check even when
# something answers there.
check_port() {
  local label="$1" port="$2" probe="$3" identifies="${4:-0}" failed=0
  eval "$probe" >/dev/null 2>&1 || failed=1
  inspect_port "$port"
  if [ "$identifies" = 1 ] && [ "$failed" = 0 ]; then
    [ "$H_KIND" = foreign ] && H_KIND=elsewhere
  elif [ "$H_KIND" = foreign ] || { [ "$identifies" = 1 ] && [ "$H_KIND" = hidden ]; }; then
    failed=1
    foreign="$foreign $port"
  fi
  if [ "$failed" = 0 ]; then
    green "  ✔ $label"
    case "$H_KIND" in worktree:* | elsewhere) print_holder "$port" ;; esac
    ok=$((ok + 1))
  else
    red "  ✘ $label"
    print_holder "$port"
    fail=$((fail + 1))
  fi
}

# ClubSpace API: /healthz answers {"status":"ok"}, and the reply carries the
# API's own throttler header (x-ratelimit-limit-short) — or /readyz lists its
# videoWorker check. Any other app answering on the port is not our server.
clubspace_api() {
  local base="http://127.0.0.1:$SERVER_PORT" reply
  reply="$(curl -s -m 3 -D - "$base/healthz" -w '\n%{http_code}')" || return 1
  [ "$(printf '%s' "$reply" | tail -n 1)" = 200 ] || return 1
  printf '%s' "$reply" | grep -q '"status":"ok"' || return 1
  printf '%s' "$reply" | grep -qi '^x-ratelimit-limit-short:' && return 0
  curl -s -m 8 "$base/readyz" | grep -q '"videoWorker"'
}

echo "── Mac-side services ──"
check_port "Server  ($SERVER_PORT)" "$SERVER_PORT" "clubspace_api" 1
check_port "Admin   ($ADMIN_PORT)" "$ADMIN_PORT" "curl -s -m 20 -o /dev/null -w '%{http_code}' http://127.0.0.1:$ADMIN_PORT/ | grep -qE '^[23][0-9][0-9]\$'"
check_port "Metro   ($METRO_PORT)" "$METRO_PORT" "curl -s -m 2 http://127.0.0.1:$METRO_PORT/status | grep -q 'packager-status:running'"
check "MinIO   (9000)"  "curl -s -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:9000/minio/health/live | grep -qE '^(200|400)\$'"
check "MailDev (1080)"  "curl -s -m 2 -u maildev:maildev -o /dev/null -w '%{http_code}' http://127.0.0.1:1080/api/email | grep -q '^200\$'"
check "Postgres (5432)" "nc -z 127.0.0.1 5432"
check "Redis    (6379)" "nc -z 127.0.0.1 6379"

echo
echo "── Emulator → Mac via adb reverse ──"
if ! adb get-state >/dev/null 2>&1; then
  yellow "  ! adb device not connected — skip эмуляторные проверки"
else
  for port in "$SERVER_PORT" "$METRO_PORT" 9000; do
    if adb reverse --list 2>/dev/null | grep -q "tcp:$port "; then
      green "  ✔ adb reverse tcp:$port"
      ok=$((ok + 1))
    else
      red "  ✘ adb reverse tcp:$port отсутствует — добавляю"
      if adb reverse "tcp:$port" "tcp:$port" >/dev/null; then green "    добавлено"; else red "    не получилось"; fi
      fail=$((fail + 1))
    fi
  done
  check "Emulator → 127.0.0.1:$SERVER_PORT" "adb shell toybox nc -z 127.0.0.1 $SERVER_PORT"
  check "Emulator → 127.0.0.1:$METRO_PORT" "adb shell toybox nc -z 127.0.0.1 $METRO_PORT"
  check "Emulator → 127.0.0.1:9000" "adb shell toybox nc -z 127.0.0.1 9000"
fi

if [ -n "$foreign" ]; then
  # Same suggestion as scripts/dev.sh: the first free port from 3201 / 4401 /
  # 8091 upwards for a conflicted one, the current value for an overridden one.
  suggest=""
  for var in SERVER_PORT ADMIN_PORT METRO_PORT; do
    port="${!var}"
    case "$var" in
      SERVER_PORT) default=3000 alt=3201 ;;
      ADMIN_PORT) default=4200 alt=4401 ;;
      METRO_PORT) default=8081 alt=8091 ;;
    esac
    case " $foreign " in
      *" $port "*)
        while [ -n "$(port_holder "$alt")" ] || nc -z 127.0.0.1 "$alt" >/dev/null 2>&1; do alt=$((alt + 10)); done
        suggest="$suggest $var=$alt"
        ;;
      *) [ "$port" = "$default" ] || suggest="$suggest $var=$port" ;;
    esac
  done
  echo
  red "Порты${foreign} заняты другим проектом. Запустите ClubSpace на свободных портах:"
  echo "  ${suggest# } npm run dev"
  echo "и повторите проверку с теми же переменными:"
  echo "  ${suggest# } bash scripts/demo-preflight.sh"
fi

echo
if [ "$fail" -eq 0 ]; then
  green "Всё ок ($ok чек-поинтов). Демо-стек готов."
else
  red "Есть $fail падений из $((ok + fail)). Исправьте их перед выездом."
  exit 1
fi
