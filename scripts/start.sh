#!/usr/bin/env bash
# Journey-Forge Local — dev fallback launcher (headless server, no desktop shell).
# For the native window, use:  python entry/main.py
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

# Pick a Python with fastapi/uvicorn. Prefer the project conda env, then python3.
PY="${JFL_PYTHON:-}"
if [ -z "$PY" ]; then
  if [ -x "/data14/houde.qian.2604/miniconda3/bin/python" ]; then
    PY="/data14/houde.qian.2604/miniconda3/bin/python"
  else
    PY="python3"
  fi
fi

# Seed .env.local from the example on first run.
if [ ! -f .env.local ]; then
  cp config.example.env .env.local
  echo "[start] created .env.local from config.example.env — set SF_LLM_KEY before distilling."
fi

# Export .env.local into the environment (KEY=VALUE lines).
set -a
# shellcheck disable=SC1091
. ./.env.local
set +a

echo "[start] python: $PY"
"$PY" -c "import fastapi, uvicorn" 2>/dev/null || {
  echo "[start] fastapi/uvicorn missing for $PY. Install: $PY -m pip install fastapi uvicorn" >&2
  exit 1
}

echo "[start] server → http://127.0.0.1:${JFL_PORT:-8099}/  (Ctrl-C to stop)"
echo "[start] load the extension build (extension/dist/chrome-mv3) via chrome://extensions → Load unpacked."
exec "$PY" server/server.py
