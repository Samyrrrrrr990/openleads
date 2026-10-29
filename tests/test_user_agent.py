"""One identifying User-Agent for APIs; a browser-like (but named) one for site crawls."""
import urllib.error

import pytest

from openleads import __version__, _http, config
from openleads.discover import geo
from openleads.models import Query
from openleads.sources import companies, edgar, local


@pytest.mark.parametrize("ua", [
    config.APP_USER_AGENT, config.SITE_USER_AGENT, config.USER_AGENT,
    local._UA["User-Agent"], geo._UA["User-Agent"], companies._UA["User-Agent"],
    edgar._UA["User-Agent"], config.api_headers()["User-Agent"],
])
def test_every_user_agent_names_this_version(ua):
    assert f"openleads/{__version__}" in ua


def test_api_user_agent_identifies_the_project_not_a_browser():
    assert config.APP_USER_AGENT.startswith(f"openleads/{__version__} (+https://github.com/")
    assert "Mozilla" not in config.APP_USER_AGENT          # Overpass 406s browser UAs
    assert "@" in edgar._UA["User-Agent"]                   # SEC wants a contact email
    assert config.api_headers(Accept="application/json") == {
        "User-Agent": config.APP_USER_AGENT, "Accept": "application/json"}


def test_api_calls_send_the_app_user_agent(monkeypatch):
    seen = {}

    def fake(url, headers=None, timeout=None, data=None):
        seen[url.split("/")[2]] = (headers or {}).get("User-Agent", config.USER_AGENT)
        raise urllib.error.URLError("offline")
    monkeypatch.setattr(_http, "_open", fake)
    from openleads.emails import mx
    from openleads.sources import github, hn
    mx.lookup("acme.example")
    hn._latest_thread_id(None)
    list(github.GitHubSource().search(Query(keyword="x")))
    _http.get_text("https://acme.example/team")             # a company site
    for host in ("dns.google", "hn.algolia.com", "api.github.com"):
        assert seen[host] == config.APP_USER_AGENT, host
    assert seen["acme.example"] == config.SITE_USER_AGENT


def test_contact_is_added_when_configured(monkeypatch):
    import importlib
    monkeypatch.setenv("OPENLEADS_CONTACT", "ops@example.org")
    try:
        cfg = importlib.reload(config)
        assert cfg.APP_USER_AGENT.endswith("; ops@example.org)")
    finally:
        monkeypatch.delenv("OPENLEADS_CONTACT")
        importlib.reload(config)
