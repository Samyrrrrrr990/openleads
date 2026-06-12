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

from openleads import __version__, assistant, intent, settings, ui, writers
from openleads.cache.store import Cache
from openleads.config import openrouter_key
from openleads.db import DB
from openleads.emails import netcheck
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


_COMMANDS = [
    ("/sources", "list available data sources"),
    ("/source NAME", "pin a source (yc · hn · github · domains · npi · …)"),
    ("/count N", "how many leads to fetch"),
    ("/verified", "toggle deliverable-only (safe tier)"),
    ("/deep", "toggle deep ground-truth harvesting (slower, more accurate)"),
    ("/write", "draft personalized emails for the current results"),
    ("/send [live]", "preview sends (or actually send with /send live)"),
    ("/schedule HH:MM", "install on-device daily sending at this time"),
    ("/format FMT", "csv · json · ndjson"),
    ("/export FILE", "write the last results to FILE"),
    ("/cache", "cache info (/cache clear to empty it)"),
    ("/help", "show this help"),
    ("/quit", "exit"),
]

_EXAMPLES = [
    "find 50 fintech founders, verified only",
    "emails at stripe.com",
    "send 30 emails to rust developers in Berlin for my dev tool at 9am",
]


def _help_text() -> str:
    lines = [ui.c("  Just type what you want — examples:", ui.WHITE, ui.BOLD)]
    for ex in _EXAMPLES:
        lines.append(ui.c(f"    › {ex}", ui.GREY))
    lines.append("")
    lines.append(ui.c("  Commands", ui.WHITE, ui.BOLD))
    lines.append(ui.command_palette(_COMMANDS))
    return "\n".join(lines)

EXPORT_RE = re.compile(r"^\s*(?:/export|export|save)\s+(?:to\s+|as\s+)?(\S+)\s*$", re.I)


class Session:
    """Holds sticky settings and the last result set for conversational refinement."""

    def __init__(self):
        self.source: str | None = None
        self.count: int = 20
        self.fmt: str = "csv"
        self.verified_only: bool = False
        self.deep: bool = False
        self.last_leads: list = []
        self.last_drafts: list = []
        self.cache = Cache()
        self.db = DB()

    def base_query(self) -> Query:
        return Query(source=self.source, count=self.count, fmt=self.fmt,
                     verified_only=self.verified_only, deep=self.deep)


# --------------------------------------------------------------------------- #
# Rendering (rich or plain)                                                    #
# --------------------------------------------------------------------------- #
_TIER_TAG = {"safe": "[green]safe[/]", "risky": "[yellow]risky[/]", "bad": "[red]bad[/]"}


def _render_table(leads, console):
    if _HAS_RICH and console is not None:
        from rich.markup import escape
        table = Table(show_header=True, header_style="bold red", expand=False,
                      border_style="grey37")
        for col in ("#", "tier", "Email", "Name", "Org", "conf"):
            table.add_column(col, overflow="fold")
        for i, ld in enumerate(leads, 1):
            tag = _TIER_TAG.get(ld.tier, "[dim]-[/]")
            name = f"{ld.first_name} {ld.last_name}".strip() or ld.organization
            pct = ld.confidence_pct or ld.score
            table.add_row(str(i), tag,
                          escape(ld.email) if ld.email else "[dim](public record)[/]",
                          escape(name[:24]),
                          escape((ld.organization or "")[:22]),
                          f"{pct}%" if ld.email else "")
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
        _say(console, _help_text())
    elif name == "/schedule":
        _do_schedule(arg, console)
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
        _say(console, f"  deliverable-only → {sess.verified_only}")
    elif name == "/deep":
        sess.deep = not sess.deep
        _say(console, f"  deep harvesting → {sess.deep}")
    elif name == "/write":
        _do_write(sess, console)
    elif name == "/send":
        _do_send(sess, console, live=arg.strip().lower() in ("live", "--live", "yes"))
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


def _do_schedule(arg: str, console):
    """Install/remove on-device daily sending (/schedule 09:00 · /schedule off)."""
    from openleads.automate import scheduler
    arg = (arg or "").strip().lower()
    if arg in ("off", "stop", "remove", "disable"):
        res = scheduler.uninstall()
        _say(console, f"  {'[green]✓[/]' if res.get('ok') else '[red]✗[/]'} {res.get('detail')}")
        return
    if arg in ("", "status"):
        st = scheduler.status()
        state = "[green]installed[/]" if st["installed"] else "[dim]not installed[/]"
        _say(console, f"  on-device automation: {state} ({st['kind']})")
        _say(console, "  /schedule 09:00 to install · /schedule off to remove")
        return
    m = re.match(r"^(\d{1,2})(?::(\d{2}))?$", arg)
    if not m:
        _say(console, "  usage: /schedule HH:MM  (or /schedule off)")
        return
    hour, minute = int(m.group(1)), int(m.group(2) or 0)
    res = scheduler.install(hour, minute)
    _say(console, f"  {'[green]✓[/]' if res.get('ok') else '[red]✗[/]'} {res.get('detail')}")


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


def _do_write(sess: Session, console):
    """Draft personalized emails for the deliverable leads in the last result set."""
    from openleads.outreach import compose
    targets = [ld for ld in sess.last_leads if ld.email and ld.tier == "safe"]
    if not targets:
        _say(console, "  no deliverable (safe) leads to write — run a search first "
                      "(tip: add 'verified only')")
        return
    _say(console, f"  writing {len(targets)} emails…")
    sess.last_drafts = []
    for ld in targets:
        d = compose.draft(ld.to_dict())
        sess.last_drafts.append(d)
        warn = "" if d.lint.get("ok") else f"  [spam-lint {d.lint.get('score')}!]"
        _say(console, f"\n  [bold]{d.email}[/]{warn}\n  Subject: {d.subject}")
        for line in d.body.splitlines():
            _say(console, f"    {line}")
    _say(console, "\n  /send to preview delivery · /send live to actually send")


def _do_send(sess: Session, console, live: bool):
    """Send (or preview) the current drafts, honoring suppression + warmup."""
    from openleads.outreach.sender import send_drafts
    if not sess.last_drafts:
        _do_write(sess, console)
    if not sess.last_drafts:
        return
    if live:
        _say(console, "  [yellow]sending for real…[/]")
    results = send_drafts(sess.last_drafts, dry_run=not live, db=sess.db,
                          campaign="chat")
    sent = sum(1 for r in results if r.status == "sent")
    prev = sum(1 for r in results if r.status == "preview")
    skip = sum(1 for r in results if r.status == "skipped")
    err = sum(1 for r in results if r.status == "error")
    verb = "sent" if live else "previewed"
    _say(console, f"  {verb}: {sent or prev} · skipped: {skip} · errors: {err}")
    if not live:
        _say(console, "  (/send live to actually deliver)")


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


def _looks_like_action(text: str) -> bool:
    """True if the user is asking to *send/schedule*, not just search."""
    return assistant.rule_interpret(text).intent in ("campaign", "schedule")


def _run_assistant(text: str, sess: Session, console):
    """Configure a campaign/schedule from one line of natural language."""
    act, mode = assistant.interpret(text)
    _say(console, f"  [dim]assistant ({mode})[/] — {act.summary()}")

    def on_progress(kind, payload):
        if kind == "lead":
            sess.last_leads.append(payload)

    sess.last_leads = []
    result = assistant.execute(act, db=sess.db, dry_run=True, install_schedule=False,
                               on_progress=on_progress)
    if not result.get("ok"):
        _say(console, f"  [red]{result.get('message')}[/]")
        return
    leads = result.get("leads", [])
    drafts = result.get("drafts", [])
    sess.last_leads = leads
    sess.last_drafts = drafts
    if leads and _HAS_RICH:
        _render_table(leads, console)
    _say(console, f"  [green]✓[/] {result.get('message')}")
    if act.send_hour is not None:
        _say(console, f"  to make it run unattended: [yellow]/schedule "
                      f"{act.send_hour:02d}:{act.send_minute:02d}[/]")
    if drafts:
        _say(console, f"  drafted {len(drafts)} emails · [yellow]/send live[/] to deliver now")


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
        deep=base.deep,
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
        result = build_leads(q, cache=sess.cache, db=sess.db, on_progress=on_progress)
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
def _status_items() -> list:
    """The state strip shown under the welcome (source/mailbox/port-25/LLM/AI)."""
    mailbox = settings.get("smtp_user") or "not set"
    port25 = "open" if netcheck.port25_open() else "blocked (engine compensates)"
    ai = "OpenRouter" if openrouter_key() else "rules only"
    return [("brain", ai), ("mailbox", mailbox), ("port 25", port25)]


def _intro(console):
    tui = "rich" if _HAS_RICH else "plain"
    body = [
        ui.c("OpenLeads", ui.WHITE, ui.BOLD) + ui.c(f"  v{__version__}", ui.RED, ui.BOLD)
        + ui.c("   the free Apollo", ui.FAINT),
        ui.c("find anyone · verify deliverably · write · send — local-first, $0", ui.GREY),
        "",
        ui.c("Type a request, or ", ui.GREY) + ui.kbd("/help") + ui.c(" for commands.", ui.GREY),
    ]
    print(ui.box(body, title="✦ welcome", width=64))
    print(ui.status_line(_status_items() + [("ui", tui)]))
    print(ui.c("  e.g. ", ui.FAINT) + ui.c("“send 30 emails to fintech founders for my SaaS at 9am”",
                                            ui.GREY))
    print()


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
                    text = ptk.prompt("openleads ❯ ")
                else:
                    text = input("openleads ❯ ")
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
            if _looks_like_action(text):
                _run_assistant(text, session, console)
            else:
                _run_search(text, session, console)
    finally:
        session.cache.close()
        session.db.close()
    _say(console, "bye 👋")
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
