#!/usr/bin/env bash
# Pre-flight check before demoing the app on the road.
# Verifies that all moving parts (server, emulator, MinIO, MailDev) talk
# to each other through 127.0.0.1, so the demo works regardless of the
# Wi-Fi/hotspot the Mac is on.

set -u
cd "$(dirname "$0")/.."

red() { printf "\033[31m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }

ok=0
fail=0

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

echo "── Mac-side services ──"
check "Server  (3000)"  "curl -s -m 2 -o /dev/null http://127.0.0.1:3000/send-auth-code -X POST -H 'Content-Type: application/json' -d '{}' -w '%{http_code}' | grep -qE '^(201|400|422|500)\$'"
check "Metro   (8081)"  "curl -s -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:8081/status | grep -q '^200\$'"
check "MinIO   (9000)"  "curl -s -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:9000/minio/health/live | grep -qE '^(200|400)\$'"
check "MailDev (1080)"  "curl -s -m 2 -u maildev:maildev -o /dev/null -w '%{http_code}' http://127.0.0.1:1080/email | grep -q '^200\$'"
check "Postgres (5432)" "nc -z 127.0.0.1 5432"
check "Redis    (6379)" "nc -z 127.0.0.1 6379"

echo
echo "── Emulator → Mac via adb reverse ──"
if ! adb get-state >/dev/null 2>&1; then
  yellow "  ! adb device not connected — skip эмуляторные проверки"
else
  for port in 3000 8081 9000; do
    if adb reverse --list 2>/dev/null | grep -q "tcp:$port "; then
      green "  ✔ adb reverse tcp:$port"
      ok=$((ok + 1))
    else
      red "  ✘ adb reverse tcp:$port отсутствует — добавляю"
      adb reverse tcp:$port tcp:$port >/dev/null && green "    добавлено" || red "    не получилось"
      fail=$((fail + 1))
    fi
  done
  check "Emulator → 127.0.0.1:3000" "adb shell toybox nc -z 127.0.0.1 3000"
  check "Emulator → 127.0.0.1:8081" "adb shell toybox nc -z 127.0.0.1 8081"
  check "Emulator → 127.0.0.1:9000" "adb shell toybox nc -z 127.0.0.1 9000"
fi

echo
if [ "$fail" -eq 0 ]; then
  green "Всё ок ($ok чек-поинтов). Демо-стек готов."
else
  red "Есть $fail падений из $((ok + fail)). Чини перед выездом."
  exit 1
fi
