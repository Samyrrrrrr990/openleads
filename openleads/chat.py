"""
The interactive chat REPL — OpenLeads' Claude-Code-style front door.

Type a request in plain English ("find 50 fintech founders, verified only";
"pediatricians in California"; "rust developers in Berlin") and watch leads
stream in. Refine results conversationally ("only verified", "export to x.csv")
and steer precisely with slash commands.

* Pretty TUI when the ``[chat]`` extra (``rich`` + ``prompt_toolkit``) is
  installed; otherwise a clean stdlib fallback with identical behavior.
* Works fully offline with the rule-based intent parser (no API key).
* If ``OPENROUTER_API_KEY`` is set, free-form input also routes through a free
  LLM for richer understanding. The active mode is always shown.
"""
from __future__ import annotations

import re
import sys

from openleads import __version__, intent, ui, writers
from openleads.cache.store import Cache
from openleads.config import openrouter_key
from openleads.engine import build_leads
from openleads.models import Query
from openleads.sources import get_source, list_sources

# --- optional pretty deps (degrade gracefully) -----------------------------
try:  # rich for output
    from rich.console import Console
    from rich.table import Table
    _HAS_RICH = True
except Exception:  # pragma: no cover
    _HAS_RICH = False

try:  # prompt_toolkit for input
    from prompt_toolkit import PromptSession
    from prompt_toolkit.history import InMemoryHistory
    _HAS_PTK = True
except Exception:  # pragma: no cover
    _HAS_PTK = False


HELP = """\
Just type what you want, e.g.:
  find 50 fintech founders, verified only
  pediatricians in California
  rust developers in Berlin as ndjson

Slash commands:
  /sources            list available data sources
  /source NAME        pin the source (yc, github, npi, openalex, producthunt)
  /count N            set how many leads
  /verified           toggle verified-only
  /format FMT         csv | json | ndjson
  /export FILE        write the last results to FILE
  /cache              cache info  (/cache clear to empty it)
  /help               this help
  /quit               exit
"""

EXPORT_RE = re.compile(r"^\s*(?:/export|export|save)\s+(?:to\s+|as\s+)?(\S+)\s*$", re.I)


class Session:
    """Holds sticky settings and the last result set for conversational refinement."""

    def __init__(self):
        self.source: str | None = None
        self.count: int = 20
        self.fmt: str = "csv"
        self.verified_only: bool = False
        self.last_leads: list = []
        self.cache = Cache()

    def base_query(self) -> Query:
        return Query(source=self.source, count=self.count, fmt=self.fmt,
                     verified_only=self.verified_only)


# --------------------------------------------------------------------------- #
# Rendering (rich or plain)                                                    #
# --------------------------------------------------------------------------- #
def _render_table(leads, console):
    if _HAS_RICH and console is not None:
        from rich.markup import escape
        table = Table(show_header=True, header_style="bold cyan", expand=False)
        for col in ("#", "✓", "Email", "Name", "Title", "Org", "Score"):
            table.add_column(col, overflow="fold")
        for i, ld in enumerate(leads, 1):
            tag = {"verified": "[green]OK[/]", "catch_all_guess": "[yellow]~CA[/]",
                   "pattern_guess": "[yellow]~PG[/]", "none": "[dim]-[/]"}.get(ld.confidence, "?")
            name = f"{ld.first_name} {ld.last_name}".strip() or ld.organization
            table.add_row(str(i), tag,
                          escape(ld.email) if ld.email else "[dim](public record)[/]",
                          escape(name), escape((ld.title or "")[:28]),
                          escape((ld.organization or "")[:24]),
                          str(ld.score) if ld.email else "")
        console.print(table)
    else:
        for i, ld in enumerate(leads, 1):
            print(ui.lead_line(ld, i, len(leads)))


def _say(console, text):
    if _HAS_RICH and console is not None:
        console.print(text)
    else:
        # Strip rich markup for plain mode.
        print(re.sub(r"\[/?[a-z0-9 #]+\]", "", text, flags=re.I))


# --------------------------------------------------------------------------- #
# Command handling                                                            #
# --------------------------------------------------------------------------- #
def _handle_slash(cmd: str, sess: Session, console) -> bool:
    """Return True to keep looping, False to quit."""
    parts = cmd.strip().split(maxsplit=1)
    name = parts[0].lower()
    arg = parts[1].strip() if len(parts) > 1 else ""

    if name in ("/quit", "/exit", "/q"):
        return False
    if name in ("/help", "/h", "/?"):
        _say(console, HELP)
    elif name == "/sources":
        for info in list_sources():
            _say(console, f"  [cyan]{info.name:<12}[/] [{info.kind}] {info.vertical}")
    elif name == "/source":
        if get_source(arg):
            sess.source = arg
            _say(console, f"  source → [green]{arg}[/]")
        else:
            _say(console, f"  [red]unknown source:[/] {arg}")
    elif name == "/count":
        if arg.isdigit():
            sess.count = max(1, min(int(arg), 1000))
            _say(console, f"  count → {sess.count}")
        else:
            _say(console, "  usage: /count N")
    elif name == "/verified":
        sess.verified_only = not sess.verified_only
        _say(console, f"  verified-only → {sess.verified_only}")
    elif name == "/format":
        if arg in ("csv", "json", "ndjson"):
            sess.fmt = arg
            _say(console, f"  format → {arg}")
        else:
            _say(console, "  usage: /format csv|json|ndjson")
    elif name == "/export":
        _do_export(arg, sess, console)
    elif name == "/cache":
        if arg == "clear":
            n = sess.cache.clear()
            _say(console, f"  cache cleared ({n} entries)")
        else:
            info = sess.cache.info()
            _say(console, f"  cache: {info['path']} {info['counts']}")
    elif name == "/clear":
        sess.last_leads = []
        _say(console, "  cleared session results")
    else:
        _say(console, f"  [red]unknown command:[/] {name} (try /help)")
    return True


def _do_export(path: str, sess: Session, console):
    if not path:
        _say(console, "  usage: /export FILE  (or: export to FILE)")
        return
    if not sess.last_leads:
        _say(console, "  nothing to export yet — run a search first")
        return
    fmt = "csv"
    if path.endswith(".json"):
        fmt = "json"
    elif path.endswith(".ndjson"):
        fmt = "ndjson"
    writers.write(sess.last_leads, fmt=fmt, path=path)
    _say(console, f"  [green]✓[/] wrote {len(sess.last_leads)} leads → {path}")


def _maybe_refine(text: str, sess: Session, console) -> bool:
    """Handle in-memory refinements on the last results. Return True if handled."""
    low = text.strip().lower()
    m = EXPORT_RE.match(text)
    if m:
        _do_export(m.group(1), sess, console)
        return True
    if not sess.last_leads:
        return False
    if low in ("only verified", "verified only", "just verified", "keep verified"):
        kept = [ld for ld in sess.last_leads if ld.confidence == "verified"]
        sess.last_leads = kept
        _say(console, f"  filtered → {len(kept)} verified")
        _render_table(kept, console)
        return True
    return False


def _run_search(text: str, sess: Session, console):
    base = sess.base_query()
    parsed, mode = intent.parse(text)
    # Merge: parsed text wins for fields it set; session provides sticky defaults.
    q = Query(
        source=parsed.source or base.source,
        count=parsed.count if parsed.count != 20 else base.count,
        industry=parsed.industry, location=parsed.location,
        title=parsed.title, keyword=parsed.keyword,
        verified_only=parsed.verified_only or base.verified_only,
        fmt=base.fmt,
    )
    label = f"{q.source or 'auto'}"
    _say(console, f"  [dim]plan[/] source=[cyan]{label}[/] count={q.count} "
                  f"verified_only={q.verified_only} parser={mode}")

    leads = []

    def on_progress(kind, payload):
        if kind == "lead":
            leads.append(payload)
            if not _HAS_RICH:
                print(ui.lead_line(payload, len(leads), q.count))

    try:
        result = build_leads(q, cache=sess.cache, on_progress=on_progress)
    except ValueError as e:
        _say(console, f"  [red]{e}[/]")
        return
    sess.last_leads = result
    if _HAS_RICH:
        _render_table(result, console)
    _say(console, f"  [bold]{len(result)}[/] leads · "
                  f"{sum(1 for ld in result if ld.confidence == 'verified')} verified "
                  f"· /export FILE to save")


# --------------------------------------------------------------------------- #
# Entry point                                                                 #
# --------------------------------------------------------------------------- #
def _intro(console):
    mode = "LLM+rules" if openrouter_key() else "rules only (set OPENROUTER_API_KEY for NL)"
    tui = "rich" if _HAS_RICH else "plain"
    if _HAS_RICH and console is not None:
        from rich.panel import Panel
        console.print(Panel.fit(
            f"[bold]🧲 OpenLeads v{__version__}[/] — Apollo for everyone, free\n"
            f"[dim]parser: {mode} · ui: {tui}[/]\n"
            "type a request · /sources · /help · /quit",
            border_style="cyan"))
    else:
        print(ui.banner())
        print(f"  parser: {mode} · ui: {tui}")
        print("  type a request · /sources · /help · /quit\n")


def run() -> int:
    console = Console() if _HAS_RICH else None
    session = Session()
    _intro(console)

    # Use prompt_toolkit only on a real terminal; pipes/CI fall back to input().
    use_ptk = _HAS_PTK and sys.stdin.isatty()
    ptk = PromptSession(history=InMemoryHistory()) if use_ptk else None
    try:
        while True:
            try:
                if ptk is not None:
                    text = ptk.prompt("openleads> ")
                else:
                    text = input("openleads> ")
            except (EOFError, KeyboardInterrupt):
                print()
                break
            text = text.strip()
            if not text:
                continue
            if text.startswith("/"):
                if not _handle_slash(text, session, console):
                    break
                continue
            if _maybe_refine(text, session, console):
                continue
            _run_search(text, session, console)
    finally:
        session.cache.close()
    _say(console, "bye 👋")
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
