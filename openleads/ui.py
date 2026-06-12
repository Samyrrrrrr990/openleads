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
