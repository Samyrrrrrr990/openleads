"""Turn new CHANGELOG lines into a short post.

Only bullets under ``## [Unreleased]`` count, and only ones not posted before, so a
day with nothing user-visible posts nothing. The changelog is written for people,
which keeps the posts readable without any extra writing step.
"""
from __future__ import annotations

import re

REPO_URL = "https://github.com/Samyrrrrrr990/openleads"
_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]+\)")
_DASH_RE = re.compile(r"\s*[—–]\s*")


def _unreleased(changelog: str) -> list:
    lines, inside = [], False
    for line in changelog.splitlines():
        if line.startswith("## "):
            if inside:
                break
            inside = line.strip().lower().startswith("## [unreleased]")
            continue
        if inside:
            lines.append(line)
    return lines


def new_entries(changelog: str, posted: list) -> list:
    """Bullets under ``## [Unreleased]`` not yet in ``posted``, in file order."""
    entries: list = []
    for line in _unreleased(changelog):
        stripped = line.strip()
        if line.startswith("- "):
            entries.append(stripped[2:])
        elif stripped and not stripped.startswith("#") and entries and line[:1] in (" ", "\t"):
            entries[-1] += " " + stripped
    seen = set(posted)
    out = []
    for e in entries:
        text = _LINK_RE.sub(r"\1", e).strip()
        if text and text not in seen:
            out.append(text)
    return out


_HANDLE_RE = re.compile(r"(?<![\w@])@(\w[\w-]*)")


def plain(text: str) -> str:
    """No long dashes, and no @handles: a GitHub name would tag a stranger on social."""
    return _HANDLE_RE.sub(r"\1", _DASH_RE.sub(", ", text))


def compose(entries: list, limit: int) -> str:
    """One post within ``limit`` characters, ending with the repo link."""
    head = "New in OpenLeads today:"
    tail = "\n\n" + REPO_URL
    room = limit - len(head) - len(tail)
    lines: list = []
    for e in (plain(x) for x in entries):
        line = "\n- " + e
        if len("".join(lines)) + len(line) <= room:
            lines.append(line)
        elif not lines and room > 8:
            lines.append(line[: room - 1].rstrip() + "…")
            break
    return head + "".join(lines) + tail
