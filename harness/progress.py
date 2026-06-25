"""Lightweight progress hook for the pipeline.

The server registers a reporter; the atomize/classify/distill stages call
report(...) so the panel can show fine-grained progress. No-op if unregistered.
"""

from __future__ import annotations

from typing import Callable, Optional

_reporter: Optional[Callable[[str, int, int, str], None]] = None


def set_reporter(cb: Optional[Callable[[str, int, int, str], None]]) -> None:
    global _reporter
    _reporter = cb


def report(phase: str, current: int = 0, total: int = 0, detail: str = "") -> None:
    if _reporter is not None:
        try:
            _reporter(phase, current, total, detail)
        except Exception:  # progress must never break the pipeline
            pass
