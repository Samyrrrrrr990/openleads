"""
Command-line interface: ``find``, ``sources``, ``verify``, ``cache``, ``chat``,
``campaign``. Running ``openleads`` with no arguments launches the chat REPL.

The non-interactive ``find`` accepts both free text (parsed by the rule-based
intent parser) and explicit flags; flags always override the parsed text.
"""
from __future__ import annotations

import argparse
import sys

from openleads import __version__, intent, ui, writers
from openleads.cache.store import Cache
from openleads.engine import build_leads
from openleads.models import Query
from openleads.sources import get_source, list_sources


def _query_from_args(args) -> Query:
    text = " ".join(args.query or []).strip()
    q = intent.rule_parse(text) if text else Query()
    # Explicit flags override parsed intent.
    if args.source is not None:
        q.source = args.source
    if args.count is not None:
        q.count = args.count
    if args.industry is not None:
        q.industry = args.industry
    if args.location is not None:
        q.location = args.location
    if args.title is not None:
        q.title = args.title
    if args.keyword is not None:
        q.keyword = args.keyword
    if args.verified_only:
        q.verified_only = True
    if args.format is not None:
        q.fmt = args.format
    if args.out is not None:
        q.out = args.out
    if args.max_companies is not None:
        q.max_companies = args.max_companies
    q.use_cache = not args.no_cache
    return q


def cmd_find(args) -> int:
    q = _query_from_args(args)
    cache = Cache() if q.use_cache else None
    print(ui.banner())
    print(f"  target: {q.count} leads · source: {q.source or 'auto'} · "
          f"guesses: {'no' if q.verified_only else 'yes'} · format: {q.fmt}")
    print("=" * 64)

    progress = {"n": 0}

    def on_progress(kind, payload):
        if kind == "phase":
            print(f"[engine] {payload}")
        elif kind == "lead":
            progress["n"] += 1
            print(ui.lead_line(payload, progress["n"], q.count))

    try:
        leads = build_leads(q, cache=cache, on_progress=on_progress)
    except ValueError as e:
        print(f"[!] {e}", file=sys.stderr)
        return 2
    finally:
        if cache:
            cache.close()

    if not leads:
        print("[!] No leads produced. Try without --verified-only or a broader query.")
        return 1

    print(ui.summary_line(leads))
    writers.write(leads, fmt=q.fmt, path=q.out)
    dest = q.out or ("leads.csv" if q.fmt == "csv" else "stdout")
    print(f"[output] wrote {len(leads)} leads -> {dest}")
    return 0


def cmd_sources(args) -> int:
    if args.subject and args.subject != "list":
        # `sources info NAME` or `sources NAME`
        name = args.name or (args.subject if args.subject != "info" else None)
        src = get_source(name) if name else None
        if not src:
            print(f"[!] unknown source: {name}", file=sys.stderr)
            return 2
        info = src.info()
        print(f"{info.name}\n  kind:        {info.kind}\n  vertical:    {info.vertical}\n"
              f"  description: {info.description}")
        return 0
    print("Available sources (drop a .py in ~/.openleads/sources to add your own):\n")
    for info in list_sources():
        print(f"  {info.name:<12} [{info.kind:<7}] {info.vertical}")
        print(f"  {'':<12} {info.description}")
    return 0


def cmd_verify(args) -> int:
    from openleads.emails.resolve import verify_address
    cache = Cache()
    try:
        for email in args.emails:
            res = verify_address(email, cache=cache)
            tag = ui.TAGS.get(res.confidence, "  ?")
            print(f"{tag} {email:<36} {res.confidence:<16} score {res.score}")
    finally:
        cache.close()
    return 0


def cmd_cache(args) -> int:
    cache = Cache()
    try:
        if args.action == "clear":
            n = cache.clear()
            print(f"[cache] cleared {n} entries")
        else:
            info = cache.info()
            print(f"[cache] {info['path']}")
            if info["counts"]:
                for ns, c in sorted(info["counts"].items()):
                    print(f"  {ns:<10} {c}")
            else:
                print("  (empty)")
    finally:
        cache.close()
    return 0


def cmd_chat(args) -> int:
    from openleads.chat import run
    return run()


def cmd_campaign(args) -> int:
    try:
        from openleads import campaign
    except ImportError as e:  # pragma: no cover
        print(f"[!] campaign needs the extra: pip install 'openleads[campaign]' ({e})",
              file=sys.stderr)
        return 2
    return campaign.main(args.rest)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="openleads",
        description="Free, open-source Apollo alternative. Find anyone, verify their email.",
    )
    p.add_argument("--version", action="version", version=f"openleads {__version__}")
    sub = p.add_subparsers(dest="command")

    f = sub.add_parser("find", help="find leads (free text and/or flags)")
    f.add_argument("query", nargs="*", help='e.g. "50 fintech founders verified only"')
    f.add_argument("-s", "--source", help="source name (see `openleads sources`)")
    f.add_argument("-n", "--count", type=int, help="how many leads (default 20)")
    f.add_argument("--industry", help="industry/tag filter")
    f.add_argument("--location", help="location filter")
    f.add_argument("--title", help="title filter")
    f.add_argument("--keyword", help="free keyword / topic")
    f.add_argument("--verified-only", action="store_true", help="keep only SMTP-verified")
    f.add_argument("--format", choices=["csv", "json", "ndjson"], help="output format")
    f.add_argument("-o", "--out", help="output path ('-' for stdout)")
    f.add_argument("--no-cache", action="store_true", help="bypass the cache")
    f.add_argument("--max-companies", type=int, help="scan budget")
    f.set_defaults(func=cmd_find)

    s = sub.add_parser("sources", help="list/inspect available sources")
    s.add_argument("subject", nargs="?", help="'list' (default) or 'info'")
    s.add_argument("name", nargs="?", help="source name for 'info'")
    s.set_defaults(func=cmd_sources)

    v = sub.add_parser("verify", help="verify one or more concrete email addresses")
    v.add_argument("emails", nargs="+")
    v.set_defaults(func=cmd_verify)

    c = sub.add_parser("cache", help="inspect or clear the cache")
    c.add_argument("action", nargs="?", choices=["info", "clear"], default="info")
    c.set_defaults(func=cmd_cache)

    ch = sub.add_parser("chat", help="launch the interactive chat REPL")
    ch.set_defaults(func=cmd_chat)

    cp = sub.add_parser("campaign", help="cold-email companion (needs [campaign] extra)")
    cp.add_argument("rest", nargs=argparse.REMAINDER)
    cp.set_defaults(func=cmd_campaign)

    return p


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    parser = build_parser()
    if not argv:
        # Bare `openleads` → chat, like running `claude`.
        return cmd_chat(argparse.Namespace())
    args = parser.parse_args(argv)
    if not getattr(args, "func", None):
        parser.print_help()
        return 0
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
