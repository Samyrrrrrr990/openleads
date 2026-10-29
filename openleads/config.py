"""
Configuration, filesystem paths, and optional environment integration.

Everything lives under ``~/.openleads`` (overridable via ``OPENLEADS_HOME``).
The only *optional* env vars are:

* ``OPENROUTER_API_KEY`` — unlocks free-form natural-language chat via a free LLM.
* ``GITHUB_TOKEN``       — raises the GitHub source's rate limit (keyless works too).
* ``OPENLEADS_CONTACT``  — an email/URL added to the API User-Agent (polite heavy use).
* ``OPENLEADS_HTTP_RETRIES`` — retries per request on 429/5xx/timeouts (default 2).
* ``OPENLEADS_OVERPASS_URLS`` — comma-separated Overpass endpoints to use instead.

No env var is required for any core feature. OpenLeads runs at $0 with nothing set.
"""
from __future__ import annotations

import os
from pathlib import Path

from openleads import __version__  # set by the package __init__ before any import

APP_NAME = "openleads"

# Identity used in SMTP verification probes (HELO / MAIL FROM). No mail is sent.
VERIFY_HELO = os.environ.get("OPENLEADS_HELO", "openleads.dev")
VERIFY_FROM = os.environ.get("OPENLEADS_FROM", "verify@openleads.dev")

PROJECT_URL = "https://github.com/Samyrrrrrr990/openleads"
# Optional contact (an email or URL) added to the API User-Agent, e.g. for heavy use
# of Nominatim/Overpass whose usage policies ask for a way to reach you.
CONTACT = os.environ.get("OPENLEADS_CONTACT", "").strip()

# The one identifying User-Agent for every API we call (Nominatim, Overpass,
# Wikidata, SEC, GitHub, Algolia, OpenAlex, NPI, DNS-over-HTTPS). Their usage
# policies require an application name + a way to reach the operator, and
# Overpass rejects browser-like UAs outright (HTTP 406).
APP_USER_AGENT = f"openleads/{__version__} (+{PROJECT_URL}" + (f"; {CONTACT}" if CONTACT else "") + ")"

# Company websites (homepage, /contact, /team …) are crawled with a browser-like UA
# on purpose: many small-business sites sit behind WAFs that block unknown bots,
# and those pages are written for browsers anyway. It still names openleads and
# its version, so a site owner can tell what fetched the page.
SITE_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    f"AppleWebKit/537.36 (KHTML, like Gecko) openleads/{__version__}"
)
# Back-compat name: the default UA of the shared HTTP helper (site crawls).
USER_AGENT = SITE_USER_AGENT


def api_headers(**extra) -> dict:
    """Headers for an API request: the identifying :data:`APP_USER_AGENT` + ``extra``.

    Keyword names use ``_`` for ``-`` (``api_headers(Accept="…")``).
    """
    h = {"User-Agent": APP_USER_AGENT}
    h.update({k.replace("_", "-"): v for k, v in extra.items()})
    return h


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
