"""
Configuration, filesystem paths, and optional environment integration.

Everything lives under ``~/.openleads`` (overridable via ``OPENLEADS_HOME``).
The only *optional* env vars are:

* ``OPENROUTER_API_KEY`` — unlocks free-form natural-language chat via a free LLM.
* ``GITHUB_TOKEN``       — raises the GitHub source's rate limit (keyless works too).

No env var is required for any core feature. OpenLeads runs at $0 with nothing set.
"""
from __future__ import annotations

import os
from pathlib import Path

APP_NAME = "openleads"

# Identity used in SMTP verification probes (HELO / MAIL FROM). No mail is sent.
VERIFY_HELO = os.environ.get("OPENLEADS_HELO", "openleads.dev")
VERIFY_FROM = os.environ.get("OPENLEADS_FROM", "verify@openleads.dev")

# Polite, browser-like UA for public HTTP requests.
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) openleads/2.0"
)


def home() -> Path:
    """Return the OpenLeads home dir, creating it on first use."""
    base = os.environ.get("OPENLEADS_HOME")
    path = Path(base).expanduser() if base else Path.home() / ".openleads"
    path.mkdir(parents=True, exist_ok=True)
    return path


def cache_path() -> Path:
    """Location of the SQLite cache database."""
    return home() / "cache.db"


def plugins_dir() -> Path:
    """User source-plugin directory: drop a ``*.py`` here to add a vertical."""
    p = home() / "sources"
    p.mkdir(parents=True, exist_ok=True)
    return p


def openrouter_key() -> str | None:
    """Free LLM key for natural-language chat. Optional."""
    key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    return key or None


def github_token() -> str | None:
    """Optional GitHub token to raise API rate limits. Keyless still works."""
    tok = os.environ.get("GITHUB_TOKEN", "").strip()
    return tok or None
