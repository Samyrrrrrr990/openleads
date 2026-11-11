"""
The pre-send hook: one opt-in check before every real send.

Set ``presend_hook`` to a shell command or a URL and OpenLeads asks it about each
email just before sending. A command gets the email as JSON on stdin; a URL gets it
as a JSON POST. Either answers ``{"action": "send" | "hold", "reason": "..."}``.

    {"to": "...", "from": "...", "subject": "...", "body": "...",
     "first_email": true, "lead": {...}}

Any failure (timeout, non-zero exit, an answer that isn't that JSON, a plain-http
URL to another machine) follows ``presend_hook_on_error``: ``hold`` (default) or
``send``. Dry runs never call the hook; :func:`openleads.outreach.sender.send_drafts`
calls it for real sends only.
"""
from __future__ import annotations

import json
import shlex
import subprocess
import urllib.parse
import urllib.request

from openleads import settings
from openleads.models import Draft

ACTIONS = ("send", "hold")
_LOCAL_HOSTS = ("localhost", "127.0.0.1", "::1")


class HookError(Exception):
    pass


def _payload(draft: Draft, lead: dict | None, first: bool) -> dict:
    sender = settings.get("smtp_user") or ""
    return {"to": draft.email, "from": sender, "subject": draft.subject, "body": draft.body,
            "first_email": bool(first), "lead": dict(lead or {})}


def _answer(text: str) -> tuple:
    try:
        data = json.loads(text)
    except ValueError:
        raise HookError("answer isn't JSON") from None
    if not isinstance(data, dict) or data.get("action") not in ACTIONS:
        raise HookError('answer needs "action": "send" or "hold"')
    return data["action"], str(data.get("reason") or "")


def _run_command(hook: str, body: str, timeout: int) -> tuple:
    try:
        argv = shlex.split(hook)
    except ValueError as e:
        raise HookError(f"can't read the command: {e}") from None
    try:
        proc = subprocess.run(argv, input=body, capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=timeout)
    except subprocess.TimeoutExpired:
        raise HookError(f"timed out after {timeout}s") from None
    except OSError as e:
        raise HookError(str(e)) from None
    if proc.returncode != 0:
        raise HookError(f"exit status {proc.returncode}")
    return _answer(proc.stdout.strip())


def _post(url: str, body: str, timeout: int) -> tuple:
    parts = urllib.parse.urlsplit(url)
    if parts.scheme != "https" and not (parts.scheme == "http"
                                        and parts.hostname in _LOCAL_HOSTS):
        raise HookError("URL must use https (plain http only for localhost)")
    req = urllib.request.Request(url, data=body.encode(), method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return _answer(resp.read().decode())
    except HookError:
        raise
    except Exception as e:  # noqa: BLE001 — any network failure is a hook failure
        raise HookError("timed out" if "timed out" in str(e) else str(e)) from None


def check(draft: Draft, lead: dict | None = None, first: bool = True) -> tuple:
    """Ask the hook about ``draft``. Returns ``("send" | "hold", reason)``."""
    hook = str(settings.get("presend_hook") or "").strip()
    if not hook:
        return "send", ""
    timeout = max(1, int(settings.get("presend_hook_timeout") or 10))
    body = json.dumps(_payload(draft, lead, first))
    try:
        if "://" in hook.split()[0]:
            return _post(hook, body, timeout)
        return _run_command(hook, body, timeout)
    except Exception as e:  # noqa: BLE001 — a broken hook must never stop the batch
        on_error = settings.get("presend_hook_on_error")
        why = str(e) if isinstance(e, HookError) else f"{type(e).__name__}: {e}"
        return ("send" if on_error == "send" else "hold"), f"pre-send hook failed: {why}"[:300]
