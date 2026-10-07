"""
Run history and failure alerts for timed runs.

Every scheduled job (recipe, watcher, follow-up batch) appends one line to
``~/.openleads/runs.jsonl``: when it ran, how long it took, what it did, and the
error if it failed. ``openleads runs`` reads it back. When a job fails, ``notify``
tells you: a desktop notification where the OS supports one, and a POST to
``notify_webhook`` if you've set it (Slack/Discord/ntfy/Zapier all accept JSON).
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path

from openleads import config, settings

MAX_LINES = 2000          # keep the log bounded; older lines are trimmed


def log_path() -> Path:
    return config.home() / "runs.jsonl"


def record(kind: str, name: str, ok: bool, seconds: float, detail: dict | None = None,
           error: str = "", path: Path | None = None) -> dict:
    """Append one run to the history and return it."""
    entry = {
        "at": datetime.now().isoformat(timespec="seconds"),
        "kind": kind, "name": name, "ok": bool(ok), "seconds": round(seconds, 1),
        "detail": detail or {}, "error": error,
    }
    p = path or log_path()
    try:
        with open(p, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, default=str) + "\n")
        _trim(p)
    except OSError:
        pass
    return entry


def _trim(p: Path) -> None:
    try:
        lines = p.read_text(encoding="utf-8").splitlines()
    except OSError:
        return
    if len(lines) > MAX_LINES:
        p.write_text("\n".join(lines[-MAX_LINES:]) + "\n", encoding="utf-8")


def recent(limit: int = 20, path: Path | None = None) -> list[dict]:
    """The latest ``limit`` runs, newest first."""
    p = path or log_path()
    try:
        lines = p.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    out = []
    for ln in reversed(lines):
        try:
            out.append(json.loads(ln))
        except ValueError:
            continue
        if len(out) >= limit:
            break
    return out


def timed(kind: str, name: str, fn, *args, **kwargs) -> tuple[dict | None, dict]:
    """Run ``fn``, record it, alert on failure. Returns ``(result, history_entry)``.

    Exceptions are caught so one broken job never stops the rest of the tick.
    """
    t0 = time.monotonic()
    try:
        result = fn(*args, **kwargs)
    except Exception as e:  # noqa: BLE001 — a scheduled job must never crash the tick
        err = f"{type(e).__name__}: {e}"
        entry = record(kind, name, False, time.monotonic() - t0, error=err)
        notify(f"OpenLeads {kind} '{name}' failed", err)
        return None, entry
    detail = {k: v for k, v in (result or {}).items()
              if isinstance(v, (int, float, str, bool))}
    return result, record(kind, name, True, time.monotonic() - t0, detail=detail)


def notify(title: str, message: str) -> None:
    """Best-effort alert: desktop notification + optional webhook. Never raises."""
    _desktop(title, message)
    url = settings.get("notify_webhook") or ""
    if url:
        body = json.dumps({"text": f"{title}: {message}", "title": title,
                           "message": message}).encode()
        req = urllib.request.Request(url, data=body, method="POST",
                                     headers={"Content-Type": "application/json"})
        try:
            urllib.request.urlopen(req, timeout=10).close()
        except Exception:  # noqa: BLE001
            pass


def _desktop(title: str, message: str) -> None:
    try:
        if sys.platform == "darwin" and shutil.which("osascript"):
            script = f"display notification {json.dumps(message)} with title {json.dumps(title)}"
            subprocess.run(["osascript", "-e", script], capture_output=True, timeout=5,
                           check=False)
        elif sys.platform.startswith("linux") and shutil.which("notify-send"):
            subprocess.run(["notify-send", title, message], capture_output=True, timeout=5,
                           check=False)
    except Exception:  # noqa: BLE001
        pass
