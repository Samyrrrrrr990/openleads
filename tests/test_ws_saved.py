"""Saved searches."""
import pytest

from openleads.db import DB
from openleads.workspace import saved


@pytest.fixture
def db(tmp_path):
    d = DB(tmp_path / "w.db")
    d.upsert_lead({"email": "jane@acme.example", "first_name": "Jane", "title": "VP Sales",
                   "organization": "Acme", "tier": "safe"})
    d.upsert_lead({"email": "bob@beta.example", "first_name": "Bob", "title": "Engineer",
                   "organization": "Beta", "tier": "safe"})
    yield d
    d.close()


def test_save_overwrite_run_delete(db):
    s = saved.save(db, " VPs ", {"seniority": ["vp"], "q": "", "tags": []})
    assert s["name"] == "VPs" and s["filters"] == {"seniority": ["vp"]}
    s2 = saved.save(db, "VPs", {"seniority": ["vp", "director"]})
    assert s2["id"] == s["id"] and s2["filters"]["seniority"] == ["vp", "director"]
    res = saved.run(db, s["id"])
    assert [r["email"] for r in res["rows"]] == ["jane@acme.example"]
    saved.save(db, "Everyone", {}, kind="companies")
    assert saved.run(db, "Everyone", kind="companies")["total"] == 2
    assert [x["name"] for x in saved.list_saved(db, "people")] == ["VPs"]
    assert len(saved.list_saved(db)) == 2
    assert saved.delete(db, "VPs") and saved.get(db, "VPs") is None
    with pytest.raises(ValueError):
        saved.run(db, "VPs")
    with pytest.raises(ValueError):
        saved.save(db, "", {})
    with pytest.raises(ValueError):
        saved.save(db, "x", {}, kind="planets")
