"""
Tags — free-form labels on contacts ("hot", "conference-2026", "needs-intro").

Case-insensitive (``Hot`` and ``hot`` are one tag), trimmed, and capped in length.
Lists are for "who's in this campaign"; tags are for everything else.
"""
from __future__ import annotations

import re

from openleads.workspace import activity

MAX_LEN = 40


def normalize(tag: str) -> str:
    t = re.sub(r"\s+", " ", str(tag or "")).strip().strip(",#")
    return t[:MAX_LEN]


def _clean(tags) -> list:
    if isinstance(tags, str):
        tags = tags.split(",")
    out = []
    for t in tags or []:
        n = normalize(t)
        if n and n.lower() not in {x.lower() for x in out}:
            out.append(n)
    return out


def _emails(emails) -> list:
    if isinstance(emails, str):
        emails = [emails]
    return sorted({(e or "").lower().strip() for e in emails or [] if (e or "").strip()})


def add(db, emails, tags) -> int:
    """Tag every contact in ``emails`` with every tag in ``tags``. Returns new pairs."""
    emails, tags = _emails(emails), _clean(tags)
    if not emails or not tags:
        return 0
    before = db.scalar("SELECT COUNT(*) FROM contact_tags", default=0)
    db.executemany("INSERT OR IGNORE INTO contact_tags (email, tag) VALUES (?,?)",
                   [(e, t) for e in emails for t in tags])
    added = db.scalar("SELECT COUNT(*) FROM contact_tags", default=0) - before
    if added:
        activity.log_many(db, "contact", emails, "tag", ", ".join(tags), {"tags": tags})
    return added


def remove(db, emails, tags) -> int:
    emails, tags = _emails(emails), _clean(tags)
    if not emails or not tags:
        return 0
    n = 0
    for t in tags:
        marks = ",".join("?" for _ in emails)
        n += db.execute(f"DELETE FROM contact_tags WHERE tag=? AND email IN ({marks})",
                        (t, *emails)).rowcount
    return n


def set_tags(db, email: str, tags) -> list:
    """Replace a contact's tags with exactly ``tags``."""
    email = (email or "").lower().strip()
    want = _clean(tags)
    have = for_contact(db, email)
    drop = [t for t in have if t.lower() not in {w.lower() for w in want}]
    if drop:
        remove(db, [email], drop)
    add(db, [email], want)
    return for_contact(db, email)


def for_contact(db, email: str) -> list:
    return [r["tag"] for r in db.query(
        "SELECT tag FROM contact_tags WHERE email=? ORDER BY tag COLLATE NOCASE",
        ((email or "").lower().strip(),))]


def for_contacts(db, emails) -> dict:
    """``{email: [tags]}`` for a page of contacts, in one query per 500."""
    emails = _emails(emails)
    out: dict = {e: [] for e in emails}
    for i in range(0, len(emails), 500):
        chunk = emails[i:i + 500]
        marks = ",".join("?" for _ in chunk)
        for r in db.query(f"SELECT email, tag FROM contact_tags WHERE email IN ({marks}) "
                          "ORDER BY tag COLLATE NOCASE", chunk):
            out.setdefault(r["email"], []).append(r["tag"])
    return out


def all_tags(db) -> list:
    """``[{tag, count}]``, most used first."""
    return db.query("SELECT tag, COUNT(*) AS count FROM contact_tags GROUP BY tag "
                    "COLLATE NOCASE ORDER BY count DESC, tag COLLATE NOCASE")


def rename(db, old: str, new: str) -> int:
    old, new = normalize(old), normalize(new)
    if not old or not new:
        return 0
    db.execute("INSERT OR IGNORE INTO contact_tags (email, tag) "
               "SELECT email, ? FROM contact_tags WHERE tag=?", (new, old))
    if old.lower() == new.lower():
        return db.execute("UPDATE contact_tags SET tag=? WHERE tag=?", (new, old)).rowcount
    return db.execute("DELETE FROM contact_tags WHERE tag=?", (old,)).rowcount


def delete(db, tag: str) -> int:
    return db.execute("DELETE FROM contact_tags WHERE tag=?", (normalize(tag),)).rowcount
