"""Tests for v4 automation: exporters, recipes, watchers (no network)."""
import pytest

from openleads.automate import exporters, recipes, watch
from openleads.models import Lead


@pytest.fixture()
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENLEADS_HOME", str(tmp_path))
    from openleads.db import DB
    d = DB(path=str(tmp_path / "ol.db"))
    yield d
    d.close()


def _leads():
    return [Lead(first_name="Ada", last_name="Lovelace", email="ada@ae.com",
                 organization="AE", tier="safe", source="local"),
            Lead(first_name="Grace", last_name="Hopper", email="grace@navy.mil",
                 organization="Navy", tier="safe", source="enrich")]


# --- exporters --------------------------------------------------------------- #
def test_leads_to_ndjson_roundtrip():
    text = exporters.leads_to_ndjson(_leads())
    lines = text.splitlines()
    assert len(lines) == 2
    import json
    assert json.loads(lines[0])["email"] == "ada@ae.com"


def test_export_csv_file(tmp_path):
    target = str(tmp_path / "out.csv")
    res = exporters.export(_leads(), sink="csv", target=target)
    assert res["ok"] and res["count"] == 2
    assert "ada@ae.com" in (tmp_path / "out.csv").read_text()


def test_export_webhook_uses_poster():
    captured = {}

    def poster(url, body, headers):
        captured["url"] = url
        captured["body"] = body.decode()
        return True, "ok"
    res = exporters.export(_leads(), sink="webhook", target="https://hook.test/x",
                           poster=poster)
    assert res["ok"] and captured["url"] == "https://hook.test/x"
    assert "ada@ae.com" in captured["body"]


def test_export_unknown_sink():
    assert exporters.export(_leads(), sink="carrierpigeon")["ok"] is False


def test_notion_and_airtable_field_mapping():
    ld = _leads()[0].to_dict()
    props = exporters.notion_properties(ld)
    assert props["Email"]["email"] == "ada@ae.com"
    assert props["Name"]["title"][0]["text"]["content"] == "Ada Lovelace"
    fields = exporters.airtable_fields(ld)
    assert fields["Email"] == "ada@ae.com" and fields["Name"] == "Ada Lovelace"


def test_export_notion_requires_token(monkeypatch):
    monkeypatch.setattr(exporters.settings, "get", lambda k, d=None: "")
    assert exporters.export(_leads(), sink="notion")["ok"] is False


# --- recipes ----------------------------------------------------------------- #
def test_normalize_spec_defaults():
    s = recipes.normalize_spec({"query": "fintech founders"})
    assert s["count"] == 25 and s["verified_only"] is True
    assert s["send"] is False and s["enabled"] is True
    assert s["send_hour"] == 9 and s["export"] is None


def test_normalize_spec_export_and_clamps():
    s = recipes.normalize_spec({"query": "x", "count": 9999, "send_hour": 30,
                                "export": {"sink": "csv", "target": "/tmp/a.csv"}})
    assert s["count"] == 1000 and s["send_hour"] == 23
    assert s["export"] == {"sink": "csv", "target": "/tmp/a.csv"}


def test_recipe_save_get_list_delete(db):
    recipes.save("growth", {"query": "agencies in Miami", "count": 10}, db=db)
    got = recipes.get("growth", db=db)
    assert got["name"] == "growth" and got["count"] == 10
    names = [r["name"] for r in recipes.list_recipes(db)]
    assert "growth" in names
    assert recipes.delete("growth", db=db) is True
    assert recipes.get("growth", db=db) is None


def test_recipe_due_respects_hour(db):
    import time
    recipes.save("m", {"query": "x", "send_hour": 9}, db=db)
    early = time.struct_time((2026, 6, 10, 8, 0, 0, 2, 161, -1))
    late = time.struct_time((2026, 6, 10, 10, 0, 0, 2, 161, -1))
    assert recipes.due(db, now=early) == []
    assert [r["name"] for r in recipes.due(db, now=late)] == ["m"]


# --- watchers ---------------------------------------------------------------- #
def test_diff_new():
    leads = _leads()
    new, domains = watch.diff_new(leads, seen={"ae.com"})
    assert [ld.email for ld in new] == ["grace@navy.mil"]
    assert set(domains) == {"ae.com", "navy.mil"}


def test_watcher_save_list_delete(db):
    watch.save_watcher(db, "miami", "agencies in Miami", sink="csv")
    assert "miami" in watch.list_watchers(db)
    assert watch.delete_watcher(db, "miami") is True
    assert "miami" not in watch.list_watchers(db)
