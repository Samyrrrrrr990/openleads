"""Offline latency benchmark: a full ``openleads.find()`` against a slow fake internet.

The live benchmark (``openleads bench``) measures real sources, so its timings move
with the weather on the public servers. This one is reproducible: every request
goes to ``tests/fakenet.py`` routes that answer after a deterministic, per-URL
delay modelled on what the live runs see —

* Overpass mirrors 3–8s each (``--scenario main-down``: the main instance hangs);
* company sites 0.3–1.5s per page, one site in ten hanging past the 8s timeout
  (``--scenario dead-sites``: one in five, including the top-ranked business);
* DNS-over-HTTPS 0.1s, Gravatar 0.15s, Wikidata 0.5–6s, SEC 1–2s;
* Nominatim's 1 request/second throttle stays real.

It runs each query through the real engine (fresh ``OPENLEADS_HOME`` per query,
SQLite cache on) and prints wall time, time to the first lead, leads, named
people and request counts.

    python bench/latency.py                       # default queries, both scenarios
    python bench/latency.py --scenario main-down --json out.json
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import re
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

import fakenet  # noqa: E402

QUERIES = ("dentists in Austin", "marketing agencies in Miami",
           "software companies in Berlin")
SCENARIOS = ("busy", "main-down", "dead-sites")

FIRST = ("Maria", "James", "Linda", "Robert", "Susan", "David", "Karen", "Daniel",
         "Laura", "Michael", "Emily", "Thomas")
LAST = ("Garcia", "Smith", "Chen", "Patel", "Nguyen", "Kowalski", "Rossi", "Murphy",
        "Fischer", "Okafor", "Silva", "Larsen")
TITLES = ("Owner", "Office Manager", "Director of Operations", "Marketing Lead")

SITE_DELAY = (0.3, 1.5)
SLOW_SITE_DELAY = (9.0, 12.0)      # past the 8s page timeout: the site "hangs"
OVERPASS_DELAY = (3.0, 8.0)
HANG = 600.0


def overpass_body(prefix: str = "biz", n: int = 60) -> str:
    els = []
    for i in range(1, n + 1):
        tags = {"amenity": "dentist", "name": f"{prefix.title()} Studio {i}",
                "website": f"https://{prefix}{i}.example", "addr:city": "Austin"}
        if i % 6 == 0:
            tags["contact:email"] = f"info@{prefix}{i}.example"
        els.append({"type": "node", "id": 9000000 + i, "lat": 30.2, "lon": -97.7,
                    "tags": tags})
    return json.dumps({"version": 0.6, "elements": els})


def _person_block(seed: int, k: int) -> str:
    name = f"{FIRST[(seed + k) % len(FIRST)]} {LAST[(seed * 3 + k) % len(LAST)]}"
    return f"<div><h3>{name}</h3><p>{TITLES[(seed + k) % len(TITLES)]}</p></div>"


def site(url: str) -> str:
    """Company sites: homepage with a mailto; even sites publish /team, every fourth
    odd one an /about with one person; /contact everywhere; the rest 404."""
    m = re.match(r"https?://(?:www\.)?([^/?#]+)(/[^?#]*)?", url)
    domain, path = m.group(1), (m.group(2) or "")
    digits = re.findall(r"\d+", domain)
    idx = int(digits[0]) if digits else len(domain)
    if path in ("", "/"):
        return (f"<html><head><title>{domain}</title>"
                f'<meta name="description" content="A business at {domain}"></head>'
                f"<body><h1>Welcome</h1>{'<p>filler text</p>' * 200}"
                f'<a href="mailto:info@{domain}">Email us</a></body></html>')
    if path == "/team" and idx % 2 == 0:
        return ("<html><body><h1>Our team</h1>"
                + "".join(_person_block(idx, k) for k in range(3)) + "</body></html>")
    if path == "/about" and idx % 4 == 1:
        return f"<html><body><h1>About</h1>{_person_block(idx, 7)}</body></html>"
    if path == "/contact":
        return f'<html><body><a href="mailto:hello@{domain}">hello@{domain}</a></body></html>'
    raise fakenet.http_error(url, 404, "not found")


def _ten_percent(idx: int) -> bool:
    return idx % 10 == 7


def _top_ranked_too(idx: int) -> bool:
    return idx % 5 == 1          # one in five, including the first-ranked site


def site_delay(url: str, hangs=_ten_percent) -> float:
    m = re.match(r"https?://(?:www\.)?([^/?#]+)", url)
    digits = re.findall(r"\d+", m.group(1) if m else "")
    slow = bool(digits) and hangs(int(digits[0]))
    return fakenet.latency(url, SLOW_SITE_DELAY if slow else SITE_DELAY)


def wikidata(url: str) -> str:
    if "wbsearchentities" in url:
        return json.dumps({"search": [{"id": "Q1"}]})
    rows = [{"company": {"value": f"http://www.wikidata.org/entity/Q{100 + i}"},
             "companyLabel": {"value": f"Softco {i}"},
             "website": {"value": f"https://softco{i}.example"},
             "countryLabel": {"value": "Germany"}} for i in range(1, 41)]
    return json.dumps({"results": {"bindings": rows}})


def sec_tickers() -> str:
    return json.dumps({str(i): {"cik_str": 1000 + i, "ticker": f"SW{i}",
                                "title": f"Software Companies Group {i}"}
                       for i in range(1, 41)})


class World(fakenet.FakeNet):
    """FakeNet whose site routes compute a per-site delay (slow sites hang)."""

    hangs = staticmethod(_ten_percent)

    def __call__(self, url, headers=None, timeout=None, data=None):
        if re.match(r"https?://(?:www\.)?(?:[^/]*\.example|[a-z]+\d+\.com)(?:/|$)", url):
            self.calls.append(url)
            self._wait(site_delay(url, self.hangs), timeout)
            return site(url)
        return super().__call__(url, headers=headers, timeout=timeout, data=data)


def build_world(scenario: str = "busy") -> World:
    net = World()
    if scenario == "dead-sites":
        net.hangs = _top_ranked_too
    main = HANG if scenario == "main-down" else OVERPASS_DELAY
    body = overpass_body()
    net.add(r"overpass-api\.de", body, delay=main)
    net.add(r"overpass\.private\.coffee", body, delay=OVERPASS_DELAY)
    net.add(r"overpass\.kumi\.systems", body, delay=OVERPASS_DELAY)
    net.add(r"nominatim\.openstreetmap\.org", "[]", delay=0.4)
    net.add(r"type=MX", fakenet.doh_mx(), delay=0.1)
    net.add(r"type=TXT", fakenet.DOH_TXT_SPF_DMARC, delay=0.1)
    net.add(r"gravatar\.com", fakenet.status(404), delay=0.15)
    net.add(r"wikidata\.org/w/api\.php", wikidata, delay=(0.5, 1.5))
    net.add(r"query\.wikidata\.org", wikidata, delay=(3.0, 6.0))
    net.add(r"sec\.gov", sec_tickers(), delay=(1.0, 2.0))
    return net


def install(net) -> None:
    """Make ``net`` the network for this process (no SMTP, no real sockets)."""
    from openleads import _http
    from openleads.emails import netcheck
    from openleads.sources import local
    _http._open = net
    netcheck.port25_open = lambda *a, **k: False
    local.BREAKER.reset()


def run_query(text: str, scenario: str, count: int = 10, budget: int = 60) -> dict:
    os.environ["OPENLEADS_HOME"] = tempfile.mkdtemp(prefix="openleads-latency-")
    os.environ["OPENLEADS_SMTP25"] = "0"
    import openleads
    net = build_world(scenario)
    install(net)
    first = []
    t0 = time.monotonic()
    res = openleads.find(text, count=count, budget=budget,
                         on_lead=lambda ld: first or first.append(time.monotonic() - t0))
    wall = time.monotonic() - t0
    dupes = sum(n - 1 for n in collections.Counter(net.calls).values() if n > 1)
    return {"query": text, "scenario": scenario, "seconds": round(wall, 2),
            "first_lead": round(first[0], 2) if first else None,
            "leads": len(res), "people": sum(1 for ld in res if ld.first_name),
            "requests": len(net.calls), "duplicate_requests": dupes,
            "peak_in_flight": net.peak_in_flight,
            "stop": res.report.stop_reason}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--scenario", choices=SCENARIOS + ("all",), default="all")
    ap.add_argument("--query", action="append", help="query to run (repeatable)")
    ap.add_argument("--count", type=int, default=10)
    ap.add_argument("--budget", type=int, default=60)
    ap.add_argument("--json", help="also write the rows to this file")
    args = ap.parse_args(argv)
    scenarios = SCENARIOS if args.scenario == "all" else (args.scenario,)
    rows = []
    print(f"{'scenario':10} {'query':30} {'secs':>6} {'first':>6} {'leads':>5} "
          f"{'people':>6} {'reqs':>5} {'dupes':>5}  stop")
    for sc in scenarios:
        for q in args.query or QUERIES:
            r = run_query(q, sc, args.count, args.budget)
            rows.append(r)
            print(f"{sc:10} {q:30} {r['seconds']:6.1f} {r['first_lead'] or 0:6.1f} "
                  f"{r['leads']:5} {r['people']:6} {r['requests']:5} "
                  f"{r['duplicate_requests']:5}  {r['stop']}", flush=True)
    secs = sorted(r["seconds"] for r in rows)
    print(f"median {secs[len(secs) // 2]:.1f}s · total {sum(secs):.1f}s · "
          f"leads {sum(r['leads'] for r in rows)} · people {sum(r['people'] for r in rows)}")
    if args.json:
        Path(args.json).write_text(json.dumps(rows, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
