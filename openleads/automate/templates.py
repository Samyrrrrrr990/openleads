"""
Reusable message templates + A/B subject selection.

Templates let users save a proven pitch and reuse it; A/B subjects rotate
deterministically per-recipient so a campaign tests two lines without manual work.
Stored as JSON under ``~/.openleads/templates.json`` (no DB migration needed).

Template body supports ``{first}``, ``{organization}``, ``{title}`` placeholders.
"""
from __future__ import annotations

import hashlib
import json

from openleads.config import home

DEFAULTS = {
    "intro": {
        "subject": ["quick question about {organization}", "{first} — quick idea"],
        "body": ("Hey {first},\n\nI came across {organization} and wanted to reach out. "
                 "We help teams like yours move faster.\n\n"
                 "Open to a quick chat this week?\n\nBest,\n{sender}"),
    },
}


def _path():
    return home() / "templates.json"


def _load() -> dict:
    try:
        return json.loads(_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _save(data: dict) -> None:
    _path().write_text(json.dumps(data, indent=2), encoding="utf-8")


def all_templates() -> dict:
    merged = dict(DEFAULTS)
    merged.update(_load())
    return merged


def get(name: str) -> dict | None:
    return all_templates().get(name)


def save(name: str, subject, body: str) -> None:
    data = _load()
    data[name] = {"subject": subject if isinstance(subject, list) else [subject],
                  "body": body}
    _save(data)


def delete(name: str) -> bool:
    data = _load()
    if name in data:
        del data[name]
        _save(data)
        return True
    return False


def pick_subject(subjects, key: str) -> str:
    """Deterministically choose one subject for ``key`` (stable A/B per recipient)."""
    if isinstance(subjects, str):
        return subjects
    if not subjects:
        return ""
    idx = int(hashlib.md5(key.encode("utf-8")).hexdigest(), 16) % len(subjects)
    return subjects[idx]


def render(name: str, lead: dict, sender: str = "Me") -> tuple[str, str]:
    """Render template ``name`` for a lead → (subject, body)."""
    tmpl = get(name) or DEFAULTS["intro"]
    ctx = {
        "first": lead.get("first_name") or "there",
        "organization": lead.get("organization") or "your team",
        "title": lead.get("title") or "",
        "sender": sender,
    }
    subject = pick_subject(tmpl["subject"], lead.get("email", "")).format(**ctx)
    body = tmpl["body"].format(**ctx)
    return subject, body
