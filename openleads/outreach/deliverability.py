"""
Sender-side deliverability — the half nobody tells you about.

Verifying the *recipient* (the rest of the engine) only gets your mail to a real
mailbox. Whether it lands in the **inbox** vs spam depends on *your* sending
domain's authentication and your sending *behavior*. This module audits both:

* :func:`preflight` checks your domain's SPF, DKIM, and DMARC — the three records
  that tell Gmail/Outlook your mail is legitimately from you. Missing these is the
  #1 reason cold email gets junked. We return a 0-100 readiness score + exact fixes.
* :func:`warmup_status` enforces a gradual ramp (a brand-new mailbox blasting 200
  cold emails on day one gets flagged instantly) and a hard daily cap.

All DNS is over DoH (stdlib); no port 25 needed.
"""
from __future__ import annotations

from datetime import date

from openleads import settings
from openleads.emails import mx

# DKIM selectors used by common providers / setups. We probe these because DKIM
# records live at an unguessable-in-general but conventional location.
COMMON_DKIM_SELECTORS = (
    "google", "selector1", "selector2", "default", "dkim", "k1", "k2",
    "mail", "s1", "s2", "smtp", "mandrill", "mailjet", "zoho", "protonmail",
)


def sender_domain(overrides: dict | None = None) -> str:
    user = (overrides or {}).get("smtp_user") or settings.get("smtp_user", "")
    return user.split("@", 1)[1].lower() if "@" in user else ""


def _has_dkim(domain: str, cache=None) -> bool:
    for sel in COMMON_DKIM_SELECTORS:
        try:
            txt = mx.parse_txt(mx._query(
                mx.TXT_RESOLVER.format(name=f"{sel}._domainkey.{domain}")))
        except Exception:
            continue
        if any("v=dkim1" in t.lower() or "k=rsa" in t.lower() for t in txt):
            return True
    return False


def preflight(domain: str | None = None, cache=None) -> dict:
    """Audit a sending domain's SPF/DKIM/DMARC. Returns score + grade + fixes."""
    domain = (domain or sender_domain()).lower()
    if not domain:
        return {"domain": "", "score": 0, "grade": "?", "ready": False,
                "spf": False, "dkim": False, "dmarc": False, "dmarc_policy": "",
                "fixes": ["Set your mailbox (smtp_user) first."]}

    health = mx.dns_health(domain, cache=cache)
    spf = health["spf_present"]
    dmarc = health["dmarc_present"]
    policy = health["dmarc_policy"]
    dkim = _has_dkim(domain, cache=cache)

    score = 0
    fixes: list[str] = []
    if spf:
        score += 30
    else:
        fixes.append("Add an SPF TXT record (v=spf1 include:<your provider> ~all).")
    if dkim:
        score += 30
    else:
        fixes.append("Enable DKIM signing in your mail provider and publish its key.")
    if dmarc:
        score += 30
        if policy and policy != "none":
            score += 10
        else:
            fixes.append("Strengthen DMARC policy from p=none toward p=quarantine.")
    else:
        fixes.append("Add a DMARC TXT record at _dmarc.<domain> (v=DMARC1; p=none; ...).")

    grade = "A" if score >= 90 else "B" if score >= 60 else "C" if score >= 30 else "F"
    return {
        "domain": domain, "score": score, "grade": grade, "ready": score >= 60,
        "spf": spf, "dkim": dkim, "dmarc": dmarc, "dmarc_policy": policy,
        "fixes": fixes,
    }


def warmup_status(db) -> dict:
    """Compute today's send allowance from the warmup ramp + daily cap.

    A fresh mailbox starts at ``warmup_start`` and gains ``warmup_step`` per day,
    never exceeding ``daily_cap``. ``remaining`` is what's left to send today.
    """
    start = int(settings.get("warmup_start"))
    step = int(settings.get("warmup_step"))
    cap = int(settings.get("daily_cap"))

    first = db.first_send_date() if db else None
    if first is None:
        day = 1
    else:
        day = (date.today() - first).days + 1
    allowance = min(cap, start + step * (day - 1))
    sent = db.sent_today() if db else 0
    remaining = max(0, allowance - sent)
    return {"day": day, "allowance": allowance, "cap": cap,
            "sent_today": sent, "remaining": remaining}
