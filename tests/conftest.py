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


_MODEL_ENV = ("OPENROUTER_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY",
              "CODEX_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY")


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
    # What's installed on the machine running the tests (a claude or codex CLI, an
    # Ollama server) must not change results: tests that need one patch it back.
    from openleads import ai, settings
    monkeypatch.setattr(ai, "_which", lambda name: None)
    monkeypatch.setattr(ai, "_ollama_models", lambda timeout=0.4: [])
    # Nor may the developer's own keys or .env: a test that wants a model sets one up.
    for k in _MODEL_ENV:
        monkeypatch.delenv(k, raising=False)
    for k in [k for k in os.environ if k.startswith("OPENLEADS_AI_")]:
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(settings._load_dotenv_once, "_done", True, raising=False)

    def no_model(url, *a, **kw):
        raise ai.AIError(f"model calls are disabled in tests: {url}")
    monkeypatch.setattr(ai, "_post", no_model)
    yield


@pytest.fixture
def set_setting():
    """Set OpenLeads settings for one test; every key it touched is unset afterwards."""
    from openleads import settings
    touched = []

    def _set(key, value):
        settings.set(key, value)
        touched.append(key)
    yield _set
    for key in touched:
        settings.unset(key)
