"""A tiny offline "internet" for end-to-end tests.

``FakeNet`` replaces :func:`openleads._http._open` (the single network seam) with a
URL router: the first route whose regex matches the URL answers — with a body, an
exception, or a callable ``(url) -> body``. Unrouted URLs fail like a refused
connection, so a test only describes the hosts it cares about.

The fixtures below are trimmed copies of real responses (Overpass, Nominatim,
DNS-over-HTTPS) so the whole pipeline — geocode, Overpass + mirrors, company
expansion, MX/SPF, scoring, the run report — runs exactly as it does live.
"""
import json
import re
import socket
import threading
import time
import urllib.error
import zlib

# --- Overpass ---------------------------------------------------------------- #
OVERPASS_OK = json.dumps({
    "version": 0.6, "generator": "Overpass API 0.7.62",
    "osm3s": {"timestamp_osm_base": "2026-10-01T00:00:00Z"},
    "elements": [
        {"type": "node", "id": 4410001, "lat": 30.2690, "lon": -97.7420, "tags": {
            "amenity": "dentist", "healthcare": "dentist", "name": "Congress Avenue Dental",
            "website": "https://congressdental.example", "addr:city": "Austin",
            "addr:state": "TX", "phone": "+1 512 555 0101"}},
        {"type": "way", "id": 5520002, "center": {"lat": 30.2810, "lon": -97.7390}, "tags": {
            "amenity": "dentist", "name": "Hyde Park Smiles",
            "contact:email": "hello@hydeparksmiles.example",
            "website": "https://hydeparksmiles.example", "addr:city": "Austin"}},
        {"type": "node", "id": 4410003, "lat": 30.2500, "lon": -97.7500, "tags": {
            "amenity": "dentist", "name": "South Lamar Family Dentistry",
            "website": "https://southlamardental.example"}},
    ],
})
OVERPASS_REMARK_TIMEOUT = json.dumps({
    "version": 0.6, "generator": "Overpass API 0.7.62", "elements": [],
    "remark": 'runtime error: Query timed out in "query" at line 3 after 26 seconds.',
})

# --- Nominatim ----------------------------------------------------------------- #
NOMINATIM_PFLUGERVILLE = json.dumps([{
    "place_id": 300158, "osm_type": "relation", "osm_id": 115390,
    "lat": "30.4393696", "lon": "-97.6200043",
    "boundingbox": ["30.3920000", "30.4950000", "-97.6850000", "-97.5590000"],
    "display_name": "Pflugerville, Travis County, Texas, United States",
    "class": "boundary", "type": "administrative",
}])

# --- DNS over HTTPS -------------------------------------------------------------- #


def doh_mx(host: str = "aspmx.l.google.com") -> str:
    return json.dumps({"Status": 0, "TC": False, "RD": True, "RA": True, "AD": False,
                       "CD": False, "Question": [{"name": "example.", "type": 15}],
                       "Answer": [{"name": "example.", "type": 15, "TTL": 300,
                                   "data": f"1 {host}."}]})


DOH_SERVFAIL = json.dumps({"Status": 2, "TC": False, "RD": True, "RA": True,
                           "Question": [{"name": "example.", "type": 15}]})
DOH_TXT_SPF_DMARC = json.dumps({"Status": 0, "Answer": [
    {"type": 16, "data": '"v=spf1 include:_spf.google.com ~all"'},
    {"type": 16, "data": '"v=DMARC1; p=quarantine"'}]})


def http_error(url: str, code: int, msg: str = "error") -> urllib.error.HTTPError:
    return urllib.error.HTTPError(url, code, msg, {}, None)


def status(code: int):
    """A route answer that fails every matching URL with HTTP ``code``."""
    def answer(url):
        raise http_error(url, code)
    return answer


def latency(url: str, delay) -> float:
    """Seconds a route takes for ``url``: a number, or ``(lo, hi)`` spread
    deterministically per URL (crc32), so a benchmark is the same every run."""
    if not delay:
        return 0.0
    if isinstance(delay, (int, float)):
        return float(delay)
    lo, hi = delay
    return lo + (hi - lo) * ((zlib.crc32(url.encode("utf-8")) % 1000) / 999.0)


class FakeNet:
    """Route URLs to canned answers; records every request in ``calls``.

    A route may take time (``delay``): the answer arrives after that many seconds,
    or — when the caller's timeout is shorter — the call fails like a real socket
    timeout once the timeout has passed. That makes latency benchmarks of the whole
    pipeline possible offline (see ``bench/latency.py``).
    """

    def __init__(self) -> None:
        self.routes: list = []
        self.calls: list = []
        self._lock = threading.Lock()
        self.in_flight = 0
        self.peak_in_flight = 0

    def add(self, pattern: str, answer, delay=None) -> "FakeNet":
        """``answer``: a body (str), an exception (raised), or ``callable(url)``.

        ``delay``: seconds (or a ``(lo, hi)`` range) before the answer arrives.
        """
        self.routes.append((re.compile(pattern), answer, delay))
        return self

    def __call__(self, url, headers=None, timeout=None, data=None):
        self.calls.append(url)
        for rx, answer, delay in self.routes:
            if rx.search(url):
                wait = latency(url, delay)
                if wait:
                    self._wait(wait, timeout)
                if callable(answer) and not isinstance(answer, BaseException):
                    answer = answer(url)
                if isinstance(answer, BaseException):
                    raise answer
                return answer
        raise urllib.error.URLError(f"fakenet: no route for {url}")

    def _wait(self, wait: float, timeout) -> None:
        with self._lock:
            self.in_flight += 1
            self.peak_in_flight = max(self.peak_in_flight, self.in_flight)
        try:
            if timeout is not None and wait > timeout:
                time.sleep(timeout)
                raise socket.timeout("timed out")
            time.sleep(wait)
        finally:
            with self._lock:
                self.in_flight -= 1

    def hits(self, pattern: str) -> list:
        rx = re.compile(pattern)
        return [u for u in self.calls if rx.search(u)]


def install(monkeypatch) -> FakeNet:
    """Install a fresh FakeNet as the network (and silence throttles / SMTP)."""
    net = FakeNet()
    monkeypatch.setattr("openleads._http._open", net)
    monkeypatch.setattr("openleads._http._sleep", lambda s: None)
    monkeypatch.setattr("openleads.discover.geo._throttle", lambda: None)
    monkeypatch.setattr("openleads.emails.netcheck.port25_open", lambda *a, **k: False)
    return net


def business_site(url: str) -> str:
    """Company sites: a homepage with a mailto, every other page 404."""
    m = re.match(r"https://(?:www\.)?([^/]+)(/.*)?$", url)
    path = (m.group(2) or "") if m else ""
    if path in ("", "/"):
        domain = m.group(1)
        return (f"<html><head><title>{domain}</title></head><body><h1>Welcome</h1>"
                f'<a href="mailto:info@{domain}">Email us</a></body></html>')
    raise http_error(url, 404, "not found")
