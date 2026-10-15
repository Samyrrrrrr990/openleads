"""Duplicate detection and merge."""
import pytest

from openleads.db import DB
from openleads.workspace import activity, duplicates, lists, notes, people, sequences, tags


@pytest.fixture
def db(tmp_path):
    d = DB(tmp_path / "w.db")
    d.upsert_lead({"email": "jane@acme.example", "first_name": "Jane", "last_name": "Doe",
                   "organization": "Acme", "tier": "risky", "score": 60})
    d.upsert_lead({"email": "jane.doe@acme.example", "first_name": "Jané", "last_name": "Doe",
                   "title": "VP Sales", "tier": "safe", "score": 90,
                   "signals": {"groundtruth_exact": True}})
    d.upsert_lead({"email": "j.doe@other.example", "first_name": "Jane", "last_name": "Doe"})
    d.upsert_lead({"email": "jane@beta.example", "first_name": "Jane", "organization": "Beta"})
    d.upsert_lead({"email": "jane2@beta.example", "first_name": "Jane", "organization": "Beta"})
    yield d
    d.close()


def test_find_groups_same_person_same_domain(db):
    groups = duplicates.find(db)
    assert len(groups) == 1                               # first-name-only pairs ignored
    assert [r["email"] for r in groups[0]] == ["jane.doe@acme.example", "jane@acme.example"]


def test_merge_moves_everything(db):
    tags.add(db, ["jane@acme.example"], "hot")
    lst = lists.create(db, "Q4")
    lists.add(db, lst["id"], ["jane@acme.example"])
    notes.add(db, "contact", "jane@acme.example", "Met at SaaStr")
    db.execute("UPDATE leads SET phone='+15125550100' WHERE email='jane@acme.example'")
    seq = sequences.create(db, "S", [{"type": "call"}], settings={"allow_risky": True})
    sequences.enroll(db, seq["id"], ["jane@acme.example"])
    out = duplicates.merge(db, "jane.doe@acme.example", ["jane@acme.example", "nobody@x.example"])
    assert out["merged"] == ["jane@acme.example"]
    keep = people.get(db, "jane.doe@acme.example")
    assert keep["phone"] == "+15125550100" and keep["title"] == "VP Sales"
    assert keep["tags"] == ["hot"] and keep["lists"][0]["name"] == "Q4"
    assert keep["sequence"]["name"] == "S"
    assert notes.for_ref(db, "contact", "jane.doe@acme.example")[0]["body"] == "Met at SaaStr"
    assert activity.timeline(db, "contact", "jane.doe@acme.example")[0]["kind"] == "merged"
    assert people.get(db, "jane@acme.example") is None
    assert duplicates.find(db) == []
    with pytest.raises(ValueError):
        duplicates.merge(db, "ghost@x.example", ["jane.doe@acme.example"])


def test_merge_all(db):
    assert duplicates.merge_all(db) == {"groups": 1, "merged": 1}
    assert duplicates.name_key({"first_name": "Dr.", "last_name": "Jané  Doe"}) == "dr jane doe"
