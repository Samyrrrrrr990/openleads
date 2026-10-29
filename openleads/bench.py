"""
Live benchmark — run a fixed set of real queries and score what comes back.

The unit tests fake the network, so they can't tell you whether a search for
"dentists in Austin" returns dentists. This does: it runs each query against the
live sources and counts what a user would actually get.

    openleads bench                       # the default suite, prints a table
    openleads bench --json bench.json --markdown BENCHMARK.md

Per query it records leads returned, how many are named people, how many emails
were found (published or server-confirmed) or built from an observed pattern vs.
guessed, how many names fail the strict person-name gate (junk), and seconds taken.
"""
from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass, field

from openleads import __version__
from openleads.discover.people import looks_like_person_name
from openleads.engine import build_leads
from openleads.intent import build_query
from openleads.runreport import SearchReport

# Spread across every source family: local businesses in several countries,
# founders, developers, companies, researchers, a named domain.
SUITE = [
    "dentists in Austin",
    "marketing agencies in Miami",
    "law firms in London",
    "accountants in Toronto",
    "software companies in Berlin",
    "gyms in Sydney",
    "fintech founders",
    "AI startup founders",
    "rust developers in Berlin",
    "machine learning researchers",
    "emails at stripe.com",
    "real estate agents in Chicago",
]


@dataclass
class QueryScore:
    query: str
    leads: int = 0
    people: int = 0
    found: int = 0        # published or server-confirmed
    pattern: int = 0      # built from a pattern seen at the domain
    guessed: int = 0
    junk_names: int = 0
    seconds: float = 0.0
    error: str = ""
    sample: list = field(default_factory=list)
    notes: str = ""           # the run report's one-line summary (sources, stop reason)
    sources: dict = field(default_factory=dict)   # source -> status
    problem: str = ""         # the report's explanation when fewer leads than asked
    repeat: int = 1           # how many runs this row summarizes (--repeat)
    leads_range: list = field(default_factory=list)     # [min, median, max] over runs
    seconds_range: list = field(default_factory=list)   # [min, median, max] over runs


def score_query(text: str, count: int = 10, budget: int = 60, cache=None, db=None) -> QueryScore:
    """Run one query live and score the results.

    ``error`` is a crash, or — when nothing came back — the run report's best
    explanation (a failed or timed-out source), so an empty row is never silent.
    """
    q = build_query(text, count=count, budget=budget)
    s = QueryScore(query=text)
    rep = SearchReport()
    t0 = time.monotonic()
    try:
        leads = build_leads(q, cache=cache, db=db, report=rep)
    except Exception as e:  # a crash is a result too
        s.error = f"{type(e).__name__}: {e}"
        leads = []
    s.seconds = round(time.monotonic() - t0, 1)
    if rep.stop_reason:
        s.notes = rep.summary()
        s.sources = {n: sr.status for n, sr in rep.sources.items()}
        if not leads and not s.error:
            s.error = rep.problem()
        if len(leads) < count:
            s.problem = rep.problem()
    s.leads = len(leads)
    for ld in leads:
        name = f"{ld.first_name} {ld.last_name}".strip()
        if name:
            s.people += 1
            if not looks_like_person_name(name):
                s.junk_names += 1
        ev = ld.evidence
        if ev == "found":
            s.found += 1
        elif ev == "pattern":
            s.pattern += 1
        elif ev == "guessed":
            s.guessed += 1
    s.sample = [f"{ld.first_name} {ld.last_name}".strip() + f" <{ld.email}> · {ld.organization}"
                for ld in leads[:3]]
    return s


def _spread(values: list) -> list:
    """``[min, median, max]`` (the lower median for an even count)."""
    vals = sorted(values)
    return [vals[0], vals[(len(vals) - 1) // 2], vals[-1]] if vals else []


def score_repeated(text: str, repeat: int = 1, **kw) -> QueryScore:
    """Run one query ``repeat`` times; return the median run, with the spread.

    Live sources vary run to run; the median run (by lead count, then time) is a
    fairer row than any single run, and ``leads_range`` / ``seconds_range`` show
    how much it moved.
    """
    runs = [score_query(text, **kw) for _ in range(max(1, int(repeat)))]
    ordered = sorted(runs, key=lambda r: (r.leads, -r.seconds))
    pick = ordered[(len(ordered) - 1) // 2]
    pick.repeat = len(runs)
    pick.leads_range = _spread([r.leads for r in runs])
    pick.seconds_range = _spread([r.seconds for r in runs])
    return pick


def run(queries=None, count: int = 10, budget: int = 60, cache=None, db=None,
        on_result=None, repeat: int = 1) -> dict:
    """Run the suite. Returns a JSON-ready report with per-query scores and totals.

    ``repeat`` > 1 runs every query that many times and reports the median run
    plus min/median/max of leads and seconds.
    """
    queries = list(queries or SUITE)
    scores = []
    for text in queries:
        s = score_repeated(text, repeat=repeat, count=count, budget=budget,
                           cache=cache, db=db)
        scores.append(s)
        if on_result:
            on_result(s)
    return report(scores, count=count, repeat=repeat)


def report(scores: list, count: int = 10, repeat: int = 1) -> dict:
    tot = {k: sum(getattr(s, k) for s in scores)
           for k in ("leads", "people", "found", "pattern", "guessed", "junk_names")}
    secs = [s.seconds for s in scores]
    tot["queries"] = len(scores)
    tot["queries_with_results"] = sum(1 for s in scores if s.leads)
    tot["fill_rate"] = round(tot["leads"] / max(1, count * len(scores)), 3)
    tot["evidence_rate"] = round((tot["found"] + tot["pattern"]) / max(1, tot["leads"]), 3)
    tot["junk_rate"] = round(tot["junk_names"] / max(1, tot["people"]), 3)
    tot["median_seconds"] = sorted(secs)[len(secs) // 2] if secs else 0
    return {
        "version": __version__,
        "date": time.strftime("%Y-%m-%d", time.gmtime()),
        "count_per_query": count,
        "repeat": max(1, int(repeat)),
        "totals": tot,
        "queries": [asdict(s) for s in scores],
    }


def to_markdown(rep: dict) -> str:
    t = rep["totals"]
    lines = [
        f"# OpenLeads live benchmark — v{rep['version']} · {rep['date']}",
        "",
        f"{t['queries']} real queries, {rep['count_per_query']} leads asked for each, "
        "run against the live public sources (no mocks)"
        + (f"; each run {rep['repeat']}×, median run shown with (min–max)."
           if rep.get("repeat", 1) > 1 else "."),
        "",
        f"- **Queries with results:** {t['queries_with_results']}/{t['queries']}",
        f"- **Fill rate:** {t['fill_rate']:.0%} of requested leads returned",
        f"- **Evidence-backed emails:** {t['evidence_rate']:.0%} "
        "(published, server-confirmed, or built from a pattern seen at that domain)",
        f"- **Junk names:** {t['junk_rate']:.0%} of people failed the person-name check",
        f"- **Median time per query:** {t['median_seconds']}s",
        "",
        "| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds | Notes |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---|",
    ]
    for q in rep["queries"]:
        leads, secs = _with_range(q["leads"], q.get("leads_range")), \
            _with_range(q["seconds"], q.get("seconds_range"))
        notes = _cell(q.get("error") or q.get("problem") or "")
        lines.append(f"| {_cell(q['query'])} | {leads} | {q['people']} | {q['found']} | "
                     f"{q['pattern']} | {q['guessed']} | {q['junk_names']} | {secs} | {notes} |")
    lines += ["", "Reproduce: `openleads bench`. Numbers vary run to run because the "
              "sources are live."]
    return "\n".join(lines) + "\n"


def _with_range(value, spread) -> str:
    """``7`` or, for repeated runs that moved, ``7 (4–9)``."""
    if spread and len(spread) == 3 and spread[0] != spread[2]:
        return f"{value} ({spread[0]}–{spread[2]})"
    return f"{value}"


def _cell(text: str) -> str:
    """Make free text safe for one Markdown table cell."""
    return str(text).replace("|", "\\|").replace("\n", " ")[:140]


def save(rep: dict, json_path: str | None = None, md_path: str | None = None) -> None:
    if json_path:
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(rep, f, indent=2)
    if md_path:
        with open(md_path, "w", encoding="utf-8") as f:
            f.write(to_markdown(rep))
