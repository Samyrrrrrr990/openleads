"""
Persistent, CLI- and web-writable configuration with a safe secret store.

v3 lets users configure everything *inside* OpenLeads — no hand-editing dotfiles
required. Two files live under ``~/.openleads`` (see :func:`openleads.config.home`):

* ``config.json``  — non-secret preferences (model, sender identity, send limits…).
* ``secrets.json`` — API keys + mailbox credentials, written ``chmod 0600``.

Resolution precedence for any key (highest first):

1. an explicit **environment variable** (back-compat with v2 / CI),
2. the **secret store** (for secret keys) or **config store** (for the rest),
3. the schema **default**.

Everything is stdlib-only (JSON, not TOML, so it works on Python 3.8+ with zero
dependencies). A tiny ``.env`` loader is included so env precedence keeps working
without requiring ``python-dotenv``.
"""
from __future__ import annotations

import json
import os
import stat
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from openleads.config import home

CONFIG_FILE = "config.json"
SECRETS_FILE = "secrets.json"


@dataclass(frozen=True)
class Setting:
    """One configurable knob, with the metadata that powers config UIs + doctor."""

    key: str
    env: tuple[str, ...]          # env var name(s) that override the store (first wins)
    secret: bool                  # stored in secrets.json (0600) and masked in listings
    type: str                     # "str" | "int" | "bool"
    default: Any
    group: str                    # for grouping in `config` / web Settings
    description: str
    choices: tuple[str, ...] = () # optional enumerated values


# --- the schema: the single source of truth for every setting ----------------- #
SCHEMA: tuple[Setting, ...] = (
    # LLM (free) — used for drafting + natural-language understanding (optional).
    Setting("openrouter_api_key", ("OPENROUTER_API_KEY",), True, "str", "",
            "ai", "OpenRouter API key — unlocks free-LLM email drafting & NL parsing."),
    Setting("openrouter_model", ("OPENROUTER_MODEL",), False, "str",
            "openai/gpt-oss-120b:free", "ai",
            "Free OpenRouter model id used for drafting."),
    # Discovery
    Setting("github_token", ("GITHUB_TOKEN",), True, "str", "",
            "discover", "GitHub token — raises API rate limits & enables commit-email ground truth."),
    # Sender identity (the From header + how drafts are framed)
    Setting("sender_name", ("SENDER_NAME",), False, "str", "",
            "sender", "Your display name in the From header & signature."),
    Setting("sender_org", ("CAMPAIGN_ORG",), False, "str", "",
            "sender", "Who you represent (used to frame drafts)."),
    Setting("sender_context", ("CAMPAIGN_CONTEXT",), False, "str", "",
            "sender", "A few lines pitching what you're reaching out about."),
    # Mailbox (SMTP) — credentials are secret
    Setting("smtp_provider", (), False, "str", "custom",
            "mailbox", "Mailbox provider preset.",
            choices=("gmail", "workspace", "outlook", "office365", "zoho", "custom")),
    Setting("smtp_host", ("SMTP_HOST",), False, "str", "",
            "mailbox", "SMTP server host (auto-filled by provider preset)."),
    Setting("smtp_port", ("SMTP_PORT",), False, "int", 465,
            "mailbox", "SMTP port (465 SSL or 587 STARTTLS)."),
    Setting("smtp_user", ("SMTP_USER", "PRIVATEMAIL_USER"), True, "str", "",
            "mailbox", "Mailbox login (usually your email address)."),
    Setting("smtp_pass", ("SMTP_PASS", "PRIVATEMAIL_PASS"), True, "str", "",
            "mailbox", "Mailbox app password (NOT your normal password)."),
    # Inbox (IMAP) — optional, for reply/bounce detection
    Setting("imap_host", ("IMAP_HOST",), False, "str", "",
            "mailbox", "IMAP host for reply/bounce detection (optional)."),
    Setting("imap_user", ("IMAP_USER",), True, "str", "",
            "mailbox", "IMAP login (defaults to smtp_user)."),
    Setting("imap_pass", ("IMAP_PASS",), True, "str", "",
            "mailbox", "IMAP password (defaults to smtp_pass)."),
    Setting("save_to_sent", (), False, "str", "auto",
            "mailbox", "Save sent mail to your IMAP Sent folder so it shows in your "
            "mail client. auto = on for all providers except Gmail (which already does it).",
            choices=("auto", "always", "never")),
    # Sending policy (deliverability guardrails)
    Setting("daily_cap", ("CAMPAIGN_MAX",), False, "int", 40,
            "sending", "Max emails to send per day (deliverability cap)."),
    Setting("warmup_start", (), False, "int", 10,
            "sending", "Warmup: emails on day 1 of a fresh mailbox."),
    Setting("warmup_step", (), False, "int", 5,
            "sending", "Warmup: how many more emails allowed each day."),
    Setting("send_delay_min", (), False, "int", 25,
            "sending", "Minimum seconds between sends (human-like pacing)."),
    Setting("send_delay_max", (), False, "int", 90,
            "sending", "Maximum seconds between sends."),
    Setting("include_risky", (), False, "bool", False,
            "sending", "Allow sending to 'risky' (unverified) addresses. Off = safer."),
    # Web dashboard
    Setting("web_port", ("OPENLEADS_WEB_PORT",), False, "int", 8787,
            "web", "Port for the local web dashboard (openleads web)."),
)

_BY_KEY = {s.key: s for s in SCHEMA}


# --- tiny stdlib .env loader (so env precedence works without python-dotenv) --- #
def _load_dotenv_once() -> None:
    if getattr(_load_dotenv_once, "_done", False):
        return
    _load_dotenv_once._done = True  # type: ignore[attr-defined]
    path = Path.cwd() / ".env"
    if not path.exists():
        return
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k, v = k.strip(), v.strip().strip('"').strip("'")
            os.environ.setdefault(k, v)  # never clobber a real env var
    except OSError:
        pass


# --- file helpers -------------------------------------------------------------- #
def _read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8")) or {}
    except (OSError, ValueError):
        return {}


def _config_path() -> Path:
    return home() / CONFIG_FILE


def _secrets_path() -> Path:
    return home() / SECRETS_FILE


def _write_secret_file(path: Path, data: dict) -> None:
    """Write secrets with 0600 perms (create the file private from the start)."""
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    try:
        path.chmod(stat.S_IRUSR | stat.S_IWUSR)  # 0600
    except OSError:
        pass


# --- coercion ------------------------------------------------------------------ #
def _coerce(setting: Setting, value: Any) -> Any:
    if value is None or value == "":
        return setting.default
    if setting.type == "int":
        try:
            return int(value)
        except (TypeError, ValueError):
            return setting.default
    if setting.type == "bool":
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in ("1", "true", "yes", "on", "y")
    return str(value)


# --- public API ---------------------------------------------------------------- #
def get(key: str, default: Any = None) -> Any:
    """Resolve ``key`` using env > store > schema-default precedence."""
    setting = _BY_KEY.get(key)
    _load_dotenv_once()
    if setting is None:  # unknown key: fall back to an uppercase env var
        return os.environ.get(key.upper(), default)

    for env in setting.env:
        if os.environ.get(env, "").strip():
            return _coerce(setting, os.environ[env].strip())

    store = _read_json(_secrets_path() if setting.secret else _config_path())
    if key in store and store[key] not in (None, ""):
        return _coerce(setting, store[key])
    return setting.default if default is None else default


def set(key: str, value: Any) -> None:
    """Persist ``key`` to the right store (secret keys → 0600 secrets.json)."""
    setting = _BY_KEY.get(key)
    if setting is None:
        raise KeyError(f"unknown setting: {key!r}")
    if setting.choices and str(value) not in setting.choices:
        raise ValueError(f"{key} must be one of {setting.choices}")
    coerced = _coerce(setting, value)
    if setting.secret:
        path = _secrets_path()
        data = _read_json(path)
        data[key] = coerced
        _write_secret_file(path, data)
    else:
        path = _config_path()
        data = _read_json(path)
        data[key] = coerced
        path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def unset(key: str) -> None:
    """Remove ``key`` from its store (env vars are untouched)."""
    setting = _BY_KEY.get(key)
    if setting is None:
        raise KeyError(f"unknown setting: {key!r}")
    path = _secrets_path() if setting.secret else _config_path()
    data = _read_json(path)
    if key in data:
        del data[key]
        if setting.secret:
            _write_secret_file(path, data)
        else:
            path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def mask(value: str) -> str:
    """Mask a secret for display: keep the last 4 chars."""
    s = str(value or "")
    if not s:
        return ""
    if len(s) <= 4:
        return "•" * len(s)
    return "•" * (len(s) - 4) + s[-4:]


def source_of(key: str) -> str:
    """Where a value currently resolves from: 'env' | 'store' | 'default'."""
    setting = _BY_KEY.get(key)
    if setting is None:
        return "unknown"
    _load_dotenv_once()
    for env in setting.env:
        if os.environ.get(env, "").strip():
            return "env"
    store = _read_json(_secrets_path() if setting.secret else _config_path())
    if key in store and store[key] not in (None, ""):
        return "store"
    return "default"


def all_settings(reveal_secrets: bool = False) -> list[dict]:
    """Resolved view of every setting, for `config list` / web Settings / doctor."""
    out = []
    for s in SCHEMA:
        raw = get(s.key)
        display = raw
        if s.secret and not reveal_secrets:
            display = mask(raw)
        out.append({
            "key": s.key, "group": s.group, "secret": s.secret, "type": s.type,
            "value": display, "is_set": bool(get(s.key)) if s.type != "bool" else True,
            "source": source_of(s.key), "description": s.description,
            "choices": list(s.choices), "default": s.default,
        })
    return out


def groups() -> list[str]:
    seen: list[str] = []
    for s in SCHEMA:
        if s.group not in seen:
            seen.append(s.group)
    return seen
