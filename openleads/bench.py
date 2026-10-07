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
from openleads.intent import rule_parse

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


def score_query(text: str, count: int = 10, budget: int = 60, cache=None, db=None) -> QueryScore:
    """Run one query live and score the results."""
    q = rule_parse(text)
    q.count, q.budget = count, budget
    s = QueryScore(query=text)
    t0 = time.monotonic()
    try:
        leads = build_leads(q, cache=cache, db=db)
    except Exception as e:  # a crash is a result too
        s.error = f"{type(e).__name__}: {e}"
        leads = []
    s.seconds = round(time.monotonic() - t0, 1)
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


def run(queries=None, count: int = 10, budget: int = 60, cache=None, db=None,
        on_result=None) -> dict:
    """Run the suite. Returns a JSON-ready report with per-query scores and totals."""
    queries = list(queries or SUITE)
    scores = []
    for text in queries:
        s = score_query(text, count=count, budget=budget, cache=cache, db=db)
        scores.append(s)
        if on_result:
            on_result(s)
    return report(scores, count=count)


def report(scores: list, count: int = 10) -> dict:
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
        "totals": tot,
        "queries": [asdict(s) for s in scores],
    }


def to_markdown(rep: dict) -> str:
    t = rep["totals"]
    lines = [
        f"# OpenLeads live benchmark — v{rep['version']} · {rep['date']}",
        "",
        f"{t['queries']} real queries, {rep['count_per_query']} leads asked for each, "
        "run against the live public sources (no mocks).",
        "",
        f"- **Queries with results:** {t['queries_with_results']}/{t['queries']}",
        f"- **Fill rate:** {t['fill_rate']:.0%} of requested leads returned",
        f"- **Evidence-backed emails:** {t['evidence_rate']:.0%} "
        "(published, server-confirmed, or built from a pattern seen at that domain)",
        f"- **Junk names:** {t['junk_rate']:.0%} of people failed the person-name check",
        f"- **Median time per query:** {t['median_seconds']}s",
        "",
        "| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for q in rep["queries"]:
        lines.append(f"| {q['query']} | {q['leads']} | {q['people']} | {q['found']} | "
                     f"{q['pattern']} | {q['guessed']} | {q['junk_names']} | {q['seconds']} |")
    lines += ["", "Reproduce: `openleads bench`. Numbers vary run to run because the "
              "sources are live."]
    return "\n".join(lines) + "\n"


def save(rep: dict, json_path: str | None = None, md_path: str | None = None) -> None:
    if json_path:
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(rep, f, indent=2)
    if md_path:
        with open(md_path, "w", encoding="utf-8") as f:
            f.write(to_markdown(rep))
