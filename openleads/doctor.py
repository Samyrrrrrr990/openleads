"""
``openleads doctor`` — a one-command health check for finding *and* sending.

Tells you, in plain language, exactly what works and what to fix: network, whether
SMTP port 25 (live verification) is open from your machine, whether your free-LLM
key and mailbox are configured, whether your mailbox logs in, and how your *sending
domain's* SPF/DKIM/DMARC look. Nothing here sends mail.
"""
from __future__ import annotations

import socket
import sys

from openleads import settings

OK, WARN, BAD = "✓", "!", "✗"


def _line(symbol: str, label: str, detail: str = "") -> None:
    print(f"  {symbol}  {label}" + (f" — {detail}" if detail else ""))


def _check_network() -> bool:
    from openleads.emails import mx
    info = mx.lookup("google.com")
    return bool(info.get("hosts"))


def _check_port25() -> tuple[bool, str]:
    """Can we open outbound port 25? (Determines if live SMTP verify works.)"""
    for host in ("alt1.aspmx.l.google.com", "aspmx.l.google.com"):
        try:
            with socket.create_connection((host, 25), timeout=6):
                return True, f"reachable via {host}"
        except OSError:
            continue
    return False, "blocked (most home ISPs do this — the engine compensates with Gravatar + ground truth)"


def run(args=None) -> int:
    print("OpenLeads doctor\n" + "=" * 40)

    print("\nRuntime")
    _line(OK, f"Python {sys.version.split()[0]}")
    for extra, mods in (("chat TUI", ("rich", "prompt_toolkit")),):
        present = all(_has(m) for m in mods)
        _line(OK if present else WARN, f"{extra}",
              "installed" if present else "optional: pip install 'openleads[chat]'")

    print("\nNetwork & verification")
    try:
        net = _check_network()
        _line(OK if net else BAD, "DNS-over-HTTPS", "reachable" if net else "no network")
    except Exception as e:  # noqa: BLE001
        _line(BAD, "DNS-over-HTTPS", str(e))
    p25_ok, p25_detail = _check_port25()
    _line(OK if p25_ok else WARN, "SMTP port 25", p25_detail)

    print("\nAI drafting (optional)")
    has_llm = bool(settings.get("openrouter_api_key"))
    _line(OK if has_llm else WARN, "OpenRouter key",
          f"model {settings.get('openrouter_model')}" if has_llm
          else "unset — drafts fall back to templates (config set openrouter_api_key …)")
    _line(OK if settings.get("github_token") else WARN, "GitHub token",
          "set" if settings.get("github_token") else "unset — keyless still works, lower rate limit")

    print("\nMailbox (sending)")
    user = settings.get("smtp_user")
    if not user:
        _line(WARN, "mailbox", "not configured — run `openleads config` to enable sending")
    else:
        from openleads.outreach import providers
        _line(OK, "mailbox", f"{user} via {settings.get('smtp_provider')}")
        ok, msg = providers.test_login()
        _line(OK if ok else BAD, "SMTP login", msg)

    if user and "@" in user:
        print("\nSending-domain authentication (inbox vs spam)")
        from openleads.outreach import deliverability
        pf = deliverability.preflight()
        _line(OK if pf["spf"] else BAD, "SPF", "present" if pf["spf"] else "missing")
        _line(OK if pf["dkim"] else WARN, "DKIM", "found" if pf["dkim"] else "not found (selector probe)")
        _line(OK if pf["dmarc"] else BAD, "DMARC",
              f"p={pf['dmarc_policy'] or 'none'}" if pf["dmarc"] else "missing")
        _line(OK if pf["ready"] else WARN, f"readiness grade {pf['grade']}", f"{pf['score']}/100")
        for fix in pf["fixes"]:
            print(f"       → {fix}")

    print("\nDone.")
    return 0


def _has(mod: str) -> bool:
    import importlib.util
    return importlib.util.find_spec(mod) is not None
