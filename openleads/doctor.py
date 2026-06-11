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


def report() -> dict:
    """Structured health report (same checks as ``run()``), for the web dashboard.

    Returns a list of grouped checks: ``{group, label, status: ok|warn|bad, detail}``.
    Nothing here sends mail; network checks are live but fast and best-effort.
    """
    checks: list[dict] = []

    def add(group, label, status, detail=""):
        checks.append({"group": group, "label": label, "status": status, "detail": detail})

    # Runtime
    add("Runtime", f"Python {sys.version.split()[0]}", "ok")
    chat_ok = all(_has(m) for m in ("rich", "prompt_toolkit"))
    add("Runtime", "chat TUI", "ok" if chat_ok else "warn",
        "installed" if chat_ok else "optional: pip install 'openleads[chat]'")

    # Network & verification
    try:
        net = _check_network()
        add("Network & verification", "DNS-over-HTTPS", "ok" if net else "bad",
            "reachable" if net else "no network")
    except Exception as e:  # noqa: BLE001
        add("Network & verification", "DNS-over-HTTPS", "bad", str(e))
    p25_ok, p25_detail = _check_port25()
    add("Network & verification", "SMTP port 25", "ok" if p25_ok else "warn", p25_detail)

    # AI drafting
    has_llm = bool(settings.get("openrouter_api_key"))
    add("AI drafting (optional)", "OpenRouter key", "ok" if has_llm else "warn",
        f"model {settings.get('openrouter_model')}" if has_llm
        else "unset — drafts fall back to templates")
    has_gh = bool(settings.get("github_token"))
    add("AI drafting (optional)", "GitHub token", "ok" if has_gh else "warn",
        "set" if has_gh else "unset — keyless still works, lower rate limit")

    # Mailbox
    user = settings.get("smtp_user")
    if not user:
        add("Mailbox (sending)", "mailbox", "warn",
            "not configured — open Settings to enable sending")
    else:
        add("Mailbox (sending)", "mailbox", "ok",
            f"{user} via {settings.get('smtp_provider')}")
        try:
            from openleads.outreach import providers
            ok, msg = providers.test_login()
            add("Mailbox (sending)", "SMTP login", "ok" if ok else "bad", msg)
        except Exception as e:  # noqa: BLE001
            add("Mailbox (sending)", "SMTP login", "bad", str(e))

    # Sending-domain authentication
    preflight = None
    if user and "@" in user:
        try:
            from openleads.outreach import deliverability
            pf = deliverability.preflight()
            preflight = pf
            add("Sending-domain auth", "SPF", "ok" if pf["spf"] else "bad",
                "present" if pf["spf"] else "missing")
            add("Sending-domain auth", "DKIM", "ok" if pf["dkim"] else "warn",
                "found" if pf["dkim"] else "not found (selector probe)")
            add("Sending-domain auth", "DMARC", "ok" if pf["dmarc"] else "bad",
                f"p={pf['dmarc_policy'] or 'none'}" if pf["dmarc"] else "missing")
            add("Sending-domain auth", f"readiness grade {pf['grade']}",
                "ok" if pf["ready"] else "warn", f"{pf['score']}/100")
        except Exception as e:  # noqa: BLE001
            add("Sending-domain auth", "preflight", "warn", str(e))

    ok = sum(1 for c in checks if c["status"] == "ok")
    warn = sum(1 for c in checks if c["status"] == "warn")
    bad = sum(1 for c in checks if c["status"] == "bad")
    return {"checks": checks, "summary": {"ok": ok, "warn": warn, "bad": bad},
            "preflight": preflight}


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
