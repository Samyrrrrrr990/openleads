"""
Mailbox provider presets + SMTP/IMAP connection helpers.

Users shouldn't have to know port numbers. Pick a provider (``gmail``,
``workspace``, ``outlook``/``office365``, ``zoho``) and we fill in the right
host/port/encryption; ``custom`` reads explicit settings. Credentials always come
from the secret store (:mod:`openleads.settings`) and are passed app-passwords,
never your normal login.

Everything is stdlib ``smtplib``/``imaplib`` — no dependencies.
"""
from __future__ import annotations

import imaplib
import re
import smtplib
import time

from openleads import settings

# host, smtp_port, ssl(True)|starttls(False), imap_host, help URL for app passwords
PRESETS = {
    "gmail": {
        "smtp_host": "smtp.gmail.com", "smtp_port": 465, "ssl": True,
        "imap_host": "imap.gmail.com",
        "help": "https://support.google.com/accounts/answer/185833 (App Passwords; needs 2FA)",
    },
    "workspace": {
        "smtp_host": "smtp.gmail.com", "smtp_port": 465, "ssl": True,
        "imap_host": "imap.gmail.com",
        "help": "Google Workspace: create an App Password at myaccount.google.com (needs 2FA)",
    },
    "outlook": {
        "smtp_host": "smtp.office365.com", "smtp_port": 587, "ssl": False,
        "imap_host": "outlook.office365.com",
        "help": "https://support.microsoft.com/account-billing/ (App Password under Security)",
    },
    "office365": {
        "smtp_host": "smtp.office365.com", "smtp_port": 587, "ssl": False,
        "imap_host": "outlook.office365.com",
        "help": "Microsoft 365: enable an App Password under Security settings.",
    },
    "zoho": {
        "smtp_host": "smtp.zoho.com", "smtp_port": 465, "ssl": True,
        "imap_host": "imap.zoho.com",
        "help": "https://www.zoho.com/mail/help/ (generate an app-specific password)",
    },
    "custom": {
        "smtp_host": "", "smtp_port": 465, "ssl": True, "imap_host": "",
        "help": "Set smtp_host/smtp_port (465=SSL, 587=STARTTLS) in config.",
    },
}


def preset(name: str) -> dict:
    return PRESETS.get((name or "custom").lower(), PRESETS["custom"])


def smtp_config(overrides: dict | None = None) -> dict:
    """Resolve the effective SMTP config from provider preset + settings + overrides."""
    provider = settings.get("smtp_provider") or "custom"
    p = preset(provider)
    host = settings.get("smtp_host") or p["smtp_host"]
    port = int(settings.get("smtp_port") or p["smtp_port"])
    # Port 587 → STARTTLS; 465 → SSL. Honor the preset's hint otherwise.
    use_ssl = (port == 465) if provider == "custom" else p["ssl"]
    if port == 587:
        use_ssl = False
    cfg = {
        "provider": provider, "host": host, "port": port, "ssl": use_ssl,
        "user": settings.get("smtp_user", ""), "password": settings.get("smtp_pass", ""),
        "help": p["help"],
    }
    if overrides:
        cfg.update({k: v for k, v in overrides.items() if v not in (None, "")})
    return cfg


def imap_config(overrides: dict | None = None) -> dict:
    provider = settings.get("smtp_provider") or "custom"
    p = preset(provider)
    cfg = {
        "host": settings.get("imap_host") or p["imap_host"],
        "user": settings.get("imap_user") or settings.get("smtp_user", ""),
        "password": settings.get("imap_pass") or settings.get("smtp_pass", ""),
    }
    if overrides:
        cfg.update({k: v for k, v in overrides.items() if v not in (None, "")})
    return cfg


def connect_smtp(cfg: dict | None = None, timeout: int = 30):
    """Open an authenticated SMTP connection. Raises on failure (caller handles)."""
    cfg = cfg or smtp_config()
    if not cfg.get("host"):
        raise RuntimeError("no SMTP host configured (set a provider or smtp_host)")
    if not cfg.get("user") or not cfg.get("password"):
        raise RuntimeError("no mailbox credentials (set smtp_user / smtp_pass)")
    if cfg["ssl"]:
        server = smtplib.SMTP_SSL(cfg["host"], cfg["port"], timeout=timeout)
    else:
        server = smtplib.SMTP(cfg["host"], cfg["port"], timeout=timeout)
        server.ehlo()
        server.starttls()
        server.ehlo()
    server.login(cfg["user"], cfg["password"])
    return server


def test_login(cfg: dict | None = None) -> tuple[bool, str]:
    """Try to log in; return (ok, human message). Used by `doctor` and connect UX."""
    cfg = cfg or smtp_config()
    try:
        server = connect_smtp(cfg)
        try:
            server.quit()
        except Exception:
            pass
        return True, f"logged in to {cfg['host']} as {cfg['user']}"
    except smtplib.SMTPAuthenticationError:
        return False, ("auth failed — for Gmail/Outlook you must use an APP PASSWORD, "
                       f"not your normal password. {cfg.get('help', '')}")
    except Exception as e:  # noqa: BLE001 — surface any connection problem to the user
        return False, f"could not connect to {cfg.get('host')}:{cfg.get('port')} — {e}"


def connect_imap(cfg: dict | None = None, timeout: int = 30):
    cfg = cfg or imap_config()
    if not cfg.get("host"):
        raise RuntimeError("no IMAP host configured")
    server = imaplib.IMAP4_SSL(cfg["host"], 993, timeout=timeout)
    server.login(cfg["user"], cfg["password"])
    return server


# --- Sent-folder visibility (so sent mail shows in the user's mail client) ---- #
# Common Sent-mailbox names across providers, tried after special-use detection.
_SENT_FALLBACKS = (
    "[Gmail]/Sent Mail", "Sent", "Sent Items", "Sent Messages",
    "INBOX.Sent", "INBOX.Sent Items",
)


def _decode_mailbox_line(line) -> str:
    return line.decode("utf-8", "ignore") if isinstance(line, (bytes, bytearray)) else str(line)


def find_sent_mailbox(server) -> str | None:
    """Locate the mailbox's Sent folder: prefer the IMAP ``\\Sent`` special-use flag.

    Returns the mailbox name (quoted form ready for APPEND) or None if not found.
    """
    try:
        typ, data = server.list()
    except Exception:
        return None
    if typ != "OK" or not data:
        return None
    names: list[str] = []
    for raw in data:
        line = _decode_mailbox_line(raw)
        # e.g.  (\HasNoChildren \Sent) "/" "[Gmail]/Sent Mail"
        m = re.match(r"\((?P<flags>[^)]*)\)\s+\S+\s+(?P<name>.+)$", line)
        if not m:
            continue
        name = m.group("name").strip().strip('"')
        if "\\sent" in m.group("flags").lower():
            return name
        names.append(name)
    # No special-use flag → match a conventional name case-insensitively.
    lower = {n.lower(): n for n in names}
    for cand in _SENT_FALLBACKS:
        if cand.lower() in lower:
            return lower[cand.lower()]
    return None


def should_save_to_sent(provider: str | None = None) -> bool:
    """Whether to APPEND sent mail to the Sent folder, honoring ``save_to_sent``.

    ``auto`` (default) appends for every provider EXCEPT Gmail/Workspace, which
    already journal SMTP-sent mail to Sent (appending would duplicate it).
    """
    mode = (settings.get("save_to_sent") or "auto").lower()
    if mode == "never":
        return False
    if mode == "always":
        return True
    provider = (provider or settings.get("smtp_provider") or "").lower()
    return provider not in ("gmail", "workspace")


def append_to_sent(raw_message: bytes, when: float | None = None,
                   cfg: dict | None = None) -> tuple[bool, str]:
    """APPEND a raw RFC822 message to the mailbox's Sent folder over IMAP.

    Best-effort and fully isolated: returns ``(ok, detail)`` and never raises, so a
    Sent-folder hiccup can't fail a real send. Requires IMAP creds (falls back to
    the SMTP creds via :func:`imap_config`).
    """
    cfg = cfg or imap_config()
    if not cfg.get("host") or not cfg.get("user") or not cfg.get("password"):
        return False, "no IMAP credentials (set imap_host/imap_user/imap_pass)"
    server = None
    try:
        server = connect_imap(cfg)
        mailbox = find_sent_mailbox(server)
        if not mailbox:
            return False, "couldn't locate a Sent mailbox"
        date_time = imaplib.Time2Internaldate(when or time.time())
        # Quote the mailbox name for APPEND (handles spaces, e.g. "[Gmail]/Sent Mail").
        typ, _ = server.append(f'"{mailbox}"', r"(\Seen)", date_time, raw_message)
        if typ == "OK":
            return True, f"saved to {mailbox}"
        return False, f"APPEND rejected ({typ})"
    except Exception as e:  # noqa: BLE001 — Sent-folder save must never break a send
        return False, str(e)
    finally:
        if server is not None:
            try:
                server.logout()
            except Exception:
                pass
