#!/usr/bin/env python3
"""Journey-Forge Local — desktop entry point.

A thin pywebview shell: starts the local server (server/server.py) on a
background thread, waits for it to come up, then opens a native window pointed
at the control panel. This is the product's "double-click to launch" entry.

Falls back to opening the panel in the default browser if pywebview isn't
installed (e.g. headless dev boxes), so the loop still works everywhere.

Usage:
    python entry/main.py          # start server + open window
    JFL_PORT=8099 python entry/main.py
"""

from __future__ import annotations

import os
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SERVER_DIR = REPO / "server"
PORT = int(os.environ.get("JFL_PORT", 8099))
URL = f"http://127.0.0.1:{PORT}/"


def _load_env_local() -> None:
    """Load REPO/.env.local into os.environ (does not override existing vars)."""
    env_file = REPO / ".env.local"
    if not env_file.exists():
        return
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))


def _start_server() -> None:
    """Run uvicorn in-process (so JFL_* env + .env.local apply to the server)."""
    sys.path.insert(0, str(SERVER_DIR))
    import uvicorn  # noqa: WPS433 (deferred so --help works without it)
    from server import app, _ensure_dirs, _load_api_keys  # type: ignore

    _ensure_dirs()
    _load_api_keys()
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")


def _wait_for_server(timeout: float = 20.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(URL, timeout=1)  # noqa: S310 (localhost)
            return True
        except urllib.error.HTTPError:
            return True  # server is up; any HTTP status means it's listening
        except (urllib.error.URLError, ConnectionError, OSError):
            time.sleep(0.25)
    return False


def main() -> int:
    _load_env_local()

    server_thread = threading.Thread(target=_start_server, daemon=True)
    server_thread.start()

    if not _wait_for_server():
        print(f"[entry] server did not start on {URL}", file=sys.stderr)
        return 1
    print(f"[entry] server up at {URL}")

    try:
        import webview  # pywebview
    except ImportError:
        import webbrowser
        print("[entry] pywebview not installed; opening the panel in your browser.")
        print("[entry] (install the desktop shell with: pip install pywebview)")
        webbrowser.open(URL)
        # keep the server alive in the foreground
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            return 0

    webview.create_window("Journey-Forge Local", URL, width=1200, height=820)
    webview.start()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
