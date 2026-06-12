"""
Terminal rendering — ASCII-art, ANSI-colored, and dependency-free.

This is what ``openleads`` looks like with nothing but Python: the non-interactive
CLI and the chat REPL's fallback. Color auto-disables when output isn't a TTY or
``NO_COLOR`` is set, so pipes and logs stay clean.

Palette: monochrome with a single **red** brand accent, plus functional tier
colors (a deliverability tool needs safe/risky/bad to be scannable at a glance).
"""
from __future__ import annotations

import os
import re
import sys
from collections import Counter

from openleads.models import Lead

# --- ANSI ------------------------------------------------------------------- #
# Color when attached to a terminal (or forced), and never when NO_COLOR is set.
_USE_COLOR = bool((sys.stdout.isatty() or os.environ.get("FORCE_COLOR"))
                  and not os.environ.get("NO_COLOR"))

RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
RED = "\033[38;5;203m"
REDB = "\033[38;5;196m"
WHITE = "\033[97m"
GREY = "\033[38;5;245m"
FAINT = "\033[38;5;240m"
GREEN = "\033[38;5;78m"
AMBER = "\033[38;5;179m"


def c(text: str, *codes: str) -> str:
    """Wrap ``text`` in ANSI ``codes`` (no-op when color is disabled)."""
    if not _USE_COLOR or not codes:
        return text
    return "".join(codes) + text + RESET


# --- the wordmark ----------------------------------------------------------- #
LOGO = r"""
  ___                  _                   _
 / _ \ _ __  ___ _ __ | |    ___  __ _  __| |___
| | | | '_ \/ _ \ '_ \| |   / _ \/ _` |/ _` / __|
| |_| | |_) |  __/ | | | |__|  __/ (_| | (_| \__ \
 \___/| .__/ \___|_| |_|_____\___|\__,_|\__,_|___/
      |_|"""


def banner() -> str:
    from openleads import __version__
    lines = LOGO.strip("\n").splitlines()
    out = ["", *[c(ln, WHITE, BOLD) for ln in lines], ""]
    out.append(c("  find anyone", WHITE) + c(" · ", FAINT) + c("verify deliverably", WHITE)
               + c(" · ", FAINT) + c("write", WHITE) + c(" · ", FAINT) + c("send", WHITE))
    out.append(c(f"  v{__version__}", RED, BOLD) + c("   free · keyless · local-first", FAINT))
    out.append("")
    return "\n".join(out)


# --- Claude-Code-style boxes, status line, palette (brand red accent) -------- #
# Rounded box-drawing characters (degrade fine in any modern terminal).
_TL, _TR, _BL, _BR, _H, _V = "╭", "╮", "╰", "╯", "─", "│"


def _visible_len(s: str) -> int:
    """Length of ``s`` ignoring ANSI escape sequences (for box padding)."""
    return len(re.sub(r"\033\[[0-9;]*m", "", s))


def box(body_lines: list[str], title: str = "", width: int = 60,
        accent: str = RED) -> str:
    """Render a rounded, brand-accented box around ``body_lines`` (Claude-Code feel)."""
    inner = width - 2
    top = c(_TL, accent)
    if title:
        label = f" {title} "
        pad = inner - _visible_len(label)
        top += c(_H, accent) + c(label, accent, BOLD) + c(_H * max(0, pad - 1), accent)
    else:
        top += c(_H * inner, accent)
    top += c(_TR, accent)
    rows = [top]
    avail = inner - 2   # one space of padding on each side
    for ln in body_lines:
        ln = _truncate_visible(ln, avail)
        pad = avail - _visible_len(ln)
        rows.append(c(_V, accent) + " " + ln + " " * max(0, pad) + " " + c(_V, accent))
    rows.append(c(_BL, accent) + c(_H * inner, accent) + c(_BR, accent))
    return "\n".join(rows)


def _truncate_visible(s: str, limit: int) -> str:
    """Trim ``s`` to ``limit`` visible chars, keeping ANSI codes balanced with RESET."""
    if _visible_len(s) <= limit:
        return s
    out, vis, i = [], 0, 0
    while i < len(s) and vis < limit - 1:
        m = re.match(r"\033\[[0-9;]*m", s[i:])
        if m:
            out.append(m.group(0))
            i += m.end()
            continue
        out.append(s[i])
        vis += 1
        i += 1
    return "".join(out) + "…" + RESET


def status_line(items: list[tuple[str, str]]) -> str:
    """A compact ``key value · key value`` status strip (dim keys, white values)."""
    parts = [c(f"{k} ", FAINT) + c(str(v), WHITE) for k, v in items]
    return "  " + c(" · ", FAINT).join(parts)


def command_palette(commands: list[tuple[str, str]], accent: str = RED) -> str:
    """A two-column slash-command list, Claude-Code style."""
    out = []
    wcmd = max((len(name) for name, _ in commands), default=0)
    for name, desc in commands:
        out.append("  " + c(name.ljust(wcmd + 2), accent, BOLD) + c(desc, GREY))
    return "\n".join(out)


def kbd(label: str) -> str:
    """Render a keycap-ish hint, e.g. ``/help``."""
    return c(label, AMBER)


# --- tiers ------------------------------------------------------------------ #
# Back-compat: v2 confidence → short tag (used by `openleads verify`).
TAGS = {"verified": "OK ", "catch_all_guess": "~CA", "pattern_guess": "~PG", "none": "  -"}

_TIER = {
    "safe": ("safe ", GREEN, BOLD),
    "risky": ("risky", AMBER),
    "bad": ("bad  ", RED),
}


def tier_tag(tier: str) -> str:
    label, *codes = _TIER.get(tier, ("  ?  ", GREY))
    return c("▌", *codes[:1]) + c(label, *codes)


def _score_bar(score: int, width: int = 10) -> str:
    score = max(0, min(100, score or 0))
    filled = round(score / 100 * width)
    col = GREEN if score >= 70 else AMBER if score >= 45 else RED
    return c("▰" * filled, col) + c("▱" * (width - filled), FAINT)


def lead_line(lead: Lead, idx: int, total: int) -> str:
    n = c(f"{idx:>3}", FAINT) if total else c("  +", FAINT)
    if lead.email:
        email = c(lead.email[:38].ljust(38), WHITE)
        # Show the calibrated deliverability likelihood (Hunter-style %), not the
        # internal additive score — it's what tells the user "how good is this?".
        pct = lead.confidence_pct or lead.score
        score = f"  {_score_bar(pct)} {c(f'{pct:>3}%', GREY)}"
    else:
        email = c("—  public record, no email".ljust(38), FAINT)
        score = ""
    who = (f"{lead.first_name} {lead.last_name}".strip()
           or lead.organization or "—")[:22]
    return f"  {n}  {tier_tag(lead.tier)}  {email}  {c(who, WHITE)}{score}"


def scan_line(scanned: int, found: int, with_domain: int) -> str:
    return (c(f"  ⋯ {scanned} checked · ", FAINT)
            + c(f"{found} found", GREEN if found else FAINT)
            + c(f" · {with_domain} emailable", FAINT))


def summary_line(leads: list) -> str:
    tiers = Counter(ld.tier for ld in leads)
    safe, risky = tiers.get("safe", 0), tiers.get("risky", 0)
    bar = ""
    if leads:
        def seg(n, col):
            return c("█" * max(0, round(n / len(leads) * 24)), col)
        bar = "   " + seg(safe, GREEN) + seg(risky, AMBER) + seg(len(leads) - safe - risky, RED)
    return ("\n" + rule() + "\n"
            + f"  {c(str(len(leads)), WHITE, BOLD)} leads   "
            + c(f"{safe} safe", GREEN, BOLD) + c(" deliverable   ", FAINT)
            + c(f"{risky} risky", AMBER) + c(" unconfirmed", FAINT) + bar)


# --- small helpers for command headers -------------------------------------- #
def rule(width: int = 54) -> str:
    return c("  " + "─" * width, FAINT)


def field(label: str, value: str) -> str:
    return c(f"  {label:>11}  ", FAINT) + c(value, WHITE)


def sources_block(infos: list) -> str:
    """Pretty ``openleads sources`` listing."""
    out = [c("\n  Available sources", WHITE, BOLD)
           + c("   drop a .py in ~/.openleads/sources to add your own\n", FAINT)]
    kinds = {"people": GREEN, "company": RED}
    for i in infos:
        dot = c("●", kinds.get(i.kind, GREY))
        out.append(f"  {dot} {c(i.name.ljust(12), WHITE, BOLD)}"
                   + c(f"[{i.kind:^7}] ", FAINT) + c(i.vertical, GREY))
        out.append(c(f"               {i.description}", FAINT))
    return "\n".join(out)
