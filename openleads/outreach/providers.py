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
import smtplib

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
