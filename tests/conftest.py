"""Shared test fixtures.

* isolate OpenLeads' home dir so tests never touch ~/.openleads;
* refuse real HTTP from the engine's fetch helper, so a test that forgets to stub
  a source fails fast instead of crawling live websites in CI.
"""
import os
import tempfile
import urllib.error

import pytest


@pytest.fixture(autouse=True, scope="session")
def _isolated_home():
    tmp = tempfile.mkdtemp(prefix="openleads-test-")
    os.environ["OPENLEADS_HOME"] = tmp
    yield tmp


@pytest.fixture(autouse=True)
def _no_live_http(monkeypatch):
    def refuse(url, *a, **kw):
        raise urllib.error.URLError(f"network disabled in tests: {url}")
    monkeypatch.setattr("openleads._http._open", refuse)
    # Overpass mirror state is per process: start every test with closed breakers
    # and never really pause between mirror rounds.
    from openleads.sources import local
    local.BREAKER.reset()
    monkeypatch.setattr(local, "_sleep", lambda s: None)
    yield
