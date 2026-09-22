#!/usr/bin/env bash
# voice-browser серверийг API түлхүүрийг сервер талд экспортлож асаана.
# Ашиглах: ./run.sh [--port 8787] [--host 127.0.0.1] [--headless] [--cdp ws://...] [--start-url https://...]
#          [--lang mn] [--ui-lang mn]
#
# Түлхүүрийг TYPESAFE_API_KEY орчны хувьсагчаас, эсвэл локал .env файлаас уншина
# (.env.example-г .env болгон хуулна). Хөтөч дээрх удирдлагын хуудас руу хэзээ ч илгээгдэхгүй.
set -euo pipefail
cd "$(dirname "$0")"

if [ -z "${TYPESAFE_API_KEY:-}" ] && [ -z "${JEV_API_KEY:-}" ] && [ -f .env ]; then
  set -a; . ./.env; set +a
fi
if [ -z "${TYPESAFE_API_KEY:-}" ] && [ -z "${JEV_API_KEY:-}" ]; then
  echo "API түлхүүр олдсонгүй. TYPESAFE_API_KEY-г export хий, эсвэл .env.example-г .env болгон хуулж бөглө (түлхүүрээ https://console.typesafe.ai/keys хаягаас авна)" >&2
  exit 1
fi

exec node src/server.js "$@"
