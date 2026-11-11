"""The daily ship-notes poster in launch/autopost (not part of the package)."""
import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def _load(name):
    path = ROOT / "launch" / "autopost" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(f"autopost_{name}", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def notes():
    return _load("notes")


@pytest.fixture
def post():
    return _load("post")


@pytest.fixture
def changelog(tmp_path):
    p = tmp_path / "CHANGELOG.md"
    p.write_text("# Changelog\n\n## [Unreleased]\n\n### Added\n"
                 "- `pypi` source: maintainers of Python packages, with their\n"
                 "  published email ([#29](https://x)).\n- Today briefing.\n\n"
                 "## [5.2.0] - 2026-11-04\n- old thing\n")
    return p


def _state(tmp_path, data=None):
    p = tmp_path / "state.json"
    p.write_text(json.dumps(data or {"posted": [], "last_devto": ""}))
    return p


def test_new_entries_only_unreleased_and_unposted(notes):
    md = ("## [Unreleased]\n\n### Added\n- `pypi` source: maintainers ([#29](x)).\n- Today briefing.\n\n"
          "## [5.2.0] - 2026-11-04\n- old thing\n")
    assert notes.new_entries(md, posted=["Today briefing."]) == ["`pypi` source: maintainers (#29)."]


def test_wrapped_bullets_join_into_one_entry(notes, changelog):
    got = notes.new_entries(changelog.read_text(), posted=[])
    assert got == ["`pypi` source: maintainers of Python packages, with their published email (#29).",
                   "Today briefing."]


def test_no_unreleased_section_means_nothing(notes):
    assert notes.new_entries("## [5.2.0] - 2026-11-04\n- old thing\n", posted=[]) == []


def test_compose_fits_limit_and_has_no_dashes(notes):
    text = notes.compose(["Searches — faster", "x" * 400], limit=280)
    assert len(text) <= 280 and "—" not in text and "–" not in text
    assert text.endswith("https://github.com/Samyrrrrrr990/openleads")
    assert "Searches, faster" in text


def test_dry_run_posts_nothing_and_keeps_state(tmp_path, post, changelog, monkeypatch, capsys):
    state = _state(tmp_path)
    before = state.read_text()
    monkeypatch.setenv("BLUESKY_HANDLE", "h")
    monkeypatch.setenv("BLUESKY_APP_PASSWORD", "p")

    def boom(*a, **k):
        raise AssertionError("network")
    monkeypatch.setattr(post, "_http", boom)
    assert post.main(["--dry-run", "--state", str(state), "--changelog", str(changelog)]) == 0
    assert state.read_text() == before
    assert "Today briefing." in capsys.readouterr().out


def test_platform_without_secrets_is_skipped(tmp_path, post, changelog, monkeypatch):
    for k in ("BLUESKY_HANDLE", "BLUESKY_APP_PASSWORD", "X_API_KEY", "X_API_SECRET",
              "X_ACCESS_TOKEN", "X_ACCESS_SECRET", "DEVTO_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    calls = []
    monkeypatch.setattr(post, "_http", lambda *a, **k: calls.append(a) or {})
    state = _state(tmp_path)
    assert post.main(["--state", str(state), "--changelog", str(changelog)]) == 0
    assert calls == []
    assert json.loads(state.read_text())["posted"] == []


def test_successful_post_records_entries(tmp_path, post, changelog, monkeypatch):
    monkeypatch.setenv("BLUESKY_HANDLE", "h")
    monkeypatch.setenv("BLUESKY_APP_PASSWORD", "p")
    for k in ("X_API_KEY", "DEVTO_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    seen = []

    def fake(method, url, headers=None, body=None):
        seen.append(url)
        return {"accessJwt": "t", "did": "d"} if "createSession" in url else {"uri": "at://x"}
    monkeypatch.setattr(post, "_http", fake)
    state = _state(tmp_path)
    assert post.main(["--state", str(state), "--changelog", str(changelog)]) == 0
    assert any("createRecord" in u for u in seen)
    assert len(json.loads(state.read_text())["posted"]) == 2
    # Second run: nothing new, nothing posted.
    seen.clear()
    assert post.main(["--state", str(state), "--changelog", str(changelog)]) == 0
    assert seen == []


def test_one_failing_platform_does_not_stop_others(tmp_path, post, changelog, monkeypatch):
    monkeypatch.setenv("BLUESKY_HANDLE", "h")
    monkeypatch.setenv("BLUESKY_APP_PASSWORD", "p")
    for k, v in (("X_API_KEY", "a"), ("X_API_SECRET", "b"), ("X_ACCESS_TOKEN", "c"),
                 ("X_ACCESS_SECRET", "d")):
        monkeypatch.setenv(k, v)
    monkeypatch.delenv("DEVTO_API_KEY", raising=False)
    seen = []

    def fake(method, url, headers=None, body=None):
        seen.append(url)
        if "x.com" in url:
            raise OSError("x is down")
        return {"accessJwt": "t", "did": "d"} if "createSession" in url else {"uri": "at://x"}
    monkeypatch.setattr(post, "_http", fake)
    state = _state(tmp_path)
    assert post.main(["--state", str(state), "--changelog", str(changelog)]) == 0
    assert any("createRecord" in u for u in seen)
    assert len(json.loads(state.read_text())["posted"]) == 2


def test_x_signature_is_oauth1(post):
    header = post.oauth1_header("POST", "https://api.x.com/2/tweets",
                                {"X_API_KEY": "k", "X_API_SECRET": "s",
                                 "X_ACCESS_TOKEN": "t", "X_ACCESS_SECRET": "ts"},
                                nonce="n", timestamp="1")
    assert header.startswith("OAuth ") and 'oauth_signature_method="HMAC-SHA1"' in header
    assert 'oauth_consumer_key="k"' in header and "oauth_signature=" in header


def test_github_handles_never_tag_people_on_social(notes):
    text = notes.compose(["New source (#29, thanks @Shalinipks)."], limit=280)
    assert "@" not in text and "thanks Shalinipks" in text
