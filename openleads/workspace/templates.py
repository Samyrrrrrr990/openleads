"""
Email templates — reusable subject + body with ``{{variables}}`` and spintax.

Syntax:

* ``{{first_name}}``            the contact's first name
* ``{{first_name | there}}``    with a fallback when it's blank
* ``{Hi|Hey|Hello}``            spintax: one option per contact, picked
                                deterministically from their email so a preview
                                matches what is sent

:func:`render` reports which variables came out blank, so the UI can warn before a
"Hi ," goes out. Rendered drafts go through the same spam linter as AI drafts.
"""
from __future__ import annotations

import hashlib
import random
import re
import time
from datetime import datetime

from openleads.models import Draft

# name → (description, example) — what the editor's variable picker shows.
VARIABLES = (
    ("first_name", "First name", "Jane"),
    ("last_name", "Last name", "Doe"),
    ("full_name", "Full name", "Jane Doe"),
    ("title", "Job title", "VP of Sales"),
    ("company", "Company name", "Acme"),
    ("domain", "Company domain", "acme.com"),
    ("website", "Company website", "https://acme.com"),
    ("industry", "Industry", "Software"),
    ("city", "City", "Austin"),
    ("country", "Country", "US"),
    ("phone", "Phone", "+1 512-555-0100"),
    ("sender_name", "Your name", "Sam"),
    ("sender_org", "Your company", "OpenLeads"),
    ("sender_context", "Your pitch (Settings)", "We help clinics fill empty slots."),
    ("day", "Weekday today", "Thursday"),
)
VARIABLE_NAMES = tuple(v[0] for v in VARIABLES)
_ALIASES = {
    "first": "first_name", "firstname": "first_name", "name": "first_name",
    "last": "last_name", "lastname": "last_name", "fullname": "full_name",
    "company_name": "company", "organization": "company", "organisation": "company",
    "account": "company", "job_title": "title", "position": "title",
    "sender": "sender_name", "my_name": "sender_name", "my_company": "sender_org",
    "pitch": "sender_context",
}
_VAR_RE = re.compile(r"\{\{\s*([a-zA-Z_][\w]*)\s*(?:\|\s*([^}]*?))?\s*\}\}")
_SPIN_RE = re.compile(r"\{([^{}]*\|[^{}]*)\}")


def context_for(contact: dict, sender: dict | None = None, now: datetime | None = None) -> dict:
    """The variable values for one contact (plus the sender's identity)."""
    from openleads import settings
    from openleads.insights.phones import display
    c = contact or {}
    first = c.get("first_name") or (c.get("name") or "").split(" ")[0]
    last = c.get("last_name") or " ".join((c.get("name") or "").split(" ")[1:])
    email = (c.get("email") or "").lower()
    domain = c.get("domain") or (email.split("@", 1)[1] if "@" in email else "")
    s = sender or {}
    return {
        "first_name": first or "", "last_name": last or "",
        "full_name": " ".join(p for p in (first, last) if p),
        "title": c.get("title") or "", "company": c.get("organization") or c.get("company") or "",
        "domain": domain, "website": c.get("website") or (f"https://{domain}" if domain else ""),
        "industry": c.get("industry") or "", "city": c.get("city") or "",
        "country": c.get("country") or "", "phone": display(c.get("phone") or ""),
        "sender_name": s.get("sender_name") or settings.get("sender_name") or "",
        "sender_org": s.get("sender_org") or settings.get("sender_org") or "",
        "sender_context": s.get("sender_context") or settings.get("sender_context") or "",
        "day": (now or datetime.now()).strftime("%A"),
    }


def _seed(seed) -> int:
    return int(hashlib.sha1(str(seed or "").encode()).hexdigest()[:12], 16)


def render(text: str, values: dict, seed="") -> tuple:
    """``(rendered, missing)`` — fill ``{{vars}}``, resolve spintax, tidy spacing."""
    missing: list = []

    def var(m):
        name = m.group(1).lower()
        name = _ALIASES.get(name, name)
        fallback = m.group(2)
        val = str(values.get(name) or "").strip()
        if not val:
            if fallback is not None and fallback.strip():
                return fallback.strip()
            if name not in missing:
                missing.append(name)
        return val

    out = _VAR_RE.sub(var, text or "")
    rng = random.Random(_seed(seed))
    for _ in range(5):                       # innermost-first, a few levels of nesting
        new = _SPIN_RE.sub(lambda m: rng.choice(m.group(1).split("|")), out)
        if new == out:
            break
        out = new
    # A blank variable shouldn't leave "Hi ," or double spaces behind.
    out = re.sub(r"[ \t]+([,.!?;:])", r"\1", out)
    out = re.sub(r"[ \t]{2,}", " ", out)
    out = "\n".join(line.rstrip() for line in out.split("\n"))
    return out.strip(), missing


def render_draft(subject: str, body: str, contact: dict, sender: dict | None = None,
                 seed=None) -> tuple:
    """``(Draft, missing)`` for one contact, spam-linted like every other draft."""
    from openleads.outreach.compose import spam_lint
    values = context_for(contact, sender)
    seed = seed if seed is not None else contact.get("email", "")
    subj, miss1 = render(subject, values, seed=f"{seed}:s")
    text, miss2 = render(body, values, seed=f"{seed}:b")
    missing = miss1 + [m for m in miss2 if m not in miss1]
    draft = Draft(email=(contact.get("email") or "").lower(), subject=subj, body=text,
                  first_name=values["first_name"], organization=values["company"],
                  lint=spam_lint(subj, text), model="template")
    return draft, missing


def variables_in(text: str) -> list:
    """The (canonical) variable names a template uses."""
    out = []
    for m in _VAR_RE.finditer(text or ""):
        name = _ALIASES.get(m.group(1).lower(), m.group(1).lower())
        if name not in out:
            out.append(name)
    return out


def unknown_variables(text: str) -> list:
    return [v for v in variables_in(text) if v not in VARIABLE_NAMES]


# --- storage -------------------------------------------------------------------- #
DEFAULTS = (
    ("Short intro", "intro", "{{company}} + {{sender_org}}",
     "{Hi|Hey} {{first_name|there}},\n\n{{sender_context}}\n\n"
     "I thought it might be relevant for {{company|your team}}. Open to a quick chat next week?"
     "\n\nBest,\n{{sender_name}}"),
    ("Local business intro", "intro", "question about {{company}}",
     "Hi {{first_name|there}},\n\nI was looking at {{company}} in {{city|your area}} and had a "
     "quick idea. {{sender_context}}\n\nWould you be open to hearing it? I can keep it to "
     "10 minutes.\n\nThanks,\n{{sender_name}}"),
    ("Founder to founder", "intro", "founder to founder",
     "Hi {{first_name|there}},\n\nI'm building {{sender_org}} and noticed what you're doing at "
     "{{company}}. {{sender_context}}\n\nAny chance you'd be up for a 15-minute call? Happy "
     "to share what we've learned either way.\n\n{{sender_name}}"),
    ("Recruiting outreach", "recruiting", "{{first_name}}, a role you might like",
     "Hi {{first_name|there}},\n\nYour work as {{title|an engineer}} at {{company}} stood out. "
     "{{sender_context}}\n\nOpen to a short conversation? No pressure if the timing's wrong."
     "\n\n{{sender_name}}"),
    ("Follow-up bump", "follow-up", "re: {{company}}",
     "Hi {{first_name|there}},\n\n{Floating this back up|Bumping this} in case it got buried. "
     "Worth a quick chat?\n\n{{sender_name}}"),
    ("Value add follow-up", "follow-up", "re: {{company}}",
     "Hi {{first_name|there}},\n\nOne more thought for {{company|your team}}: {{sender_context}}"
     "\n\nIf it's not a priority right now, no worries. Just let me know.\n\n{{sender_name}}"),
    ("Breakup", "follow-up", "closing the loop",
     "Hi {{first_name|there}},\n\nI'll stop reaching out after this one so I'm not cluttering "
     "your inbox. If the timing is ever better, just reply and I'll pick it back up.\n\n"
     "All the best,\n{{sender_name}}"),
)
_SEEDED_KEY = "templates_seeded"
EDITABLE = ("name", "subject", "body", "category")


def seed_defaults(db, force: bool = False) -> int:
    """Install the starter templates once (deleting them later doesn't bring them back)."""
    if db.kv_get(_SEEDED_KEY) and not force:
        return 0
    now = time.time()
    n = db.executemany(
        "INSERT OR IGNORE INTO templates (name, category, subject, body, created, updated) "
        "VALUES (?,?,?,?,?,?)", [(n, c, s, b, now, now) for n, c, s, b in DEFAULTS])
    db.kv_set(_SEEDED_KEY, True)
    return n


def list_templates(db, category: str | None = None) -> list:
    seed_defaults(db)
    if category:
        return db.query("SELECT * FROM templates WHERE category=? ORDER BY name COLLATE NOCASE",
                        (category,))
    return db.query("SELECT * FROM templates ORDER BY category, name COLLATE NOCASE")


def get(db, template_id) -> dict | None:
    try:
        return db.query_one("SELECT * FROM templates WHERE id=?", (int(template_id),))
    except (TypeError, ValueError):
        return db.query_one("SELECT * FROM templates WHERE name=?", (str(template_id),))


def _validate(name: str, subject: str, body: str) -> None:
    if not name.strip():
        raise ValueError("a template needs a name")
    if not body.strip():
        raise ValueError("a template needs a body")
    bad = unknown_variables(subject + "\n" + body)
    if bad:
        raise ValueError("unknown variable(s): " + ", ".join("{{" + b + "}}" for b in bad))


def create(db, name: str, subject: str, body: str, category: str = "") -> dict:
    name = " ".join((name or "").split())[:80]
    _validate(name, subject or "", body or "")
    if get(db, name):
        raise ValueError(f"a template named '{name}' already exists")
    now = time.time()
    cur = db.execute("INSERT INTO templates (name, subject, body, category, created, updated) "
                     "VALUES (?,?,?,?,?,?)", (name, subject or "", body, category or "", now, now))
    return get(db, cur.lastrowid)


def update(db, template_id, fields: dict) -> dict | None:
    cur = get(db, template_id)
    if not cur:
        return None
    merged = {**cur, **{k: v for k, v in (fields or {}).items() if k in EDITABLE}}
    _validate(merged["name"], merged["subject"] or "", merged["body"] or "")
    other = get(db, merged["name"])
    if other and other["id"] != cur["id"]:
        raise ValueError(f"a template named '{merged['name']}' already exists")
    db.execute("UPDATE templates SET name=?, subject=?, body=?, category=?, updated=? WHERE id=?",
               (merged["name"], merged["subject"], merged["body"], merged["category"] or "",
                time.time(), cur["id"]))
    return get(db, cur["id"])


def delete(db, template_id) -> bool:
    cur = get(db, template_id)
    return bool(cur) and db.execute("DELETE FROM templates WHERE id=?", (cur["id"],)).rowcount > 0


def mark_used(db, template_id, n: int = 1) -> None:
    db.execute("UPDATE templates SET used = used + ? WHERE id=?", (int(n), int(template_id)))
