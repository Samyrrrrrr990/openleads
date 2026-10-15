"""Static lists of people and companies."""
import pytest

from openleads.db import DB
from openleads.workspace import activity, lists


@pytest.fixture
def db(tmp_path):
    d = DB(tmp_path / "w.db")
    yield d
    d.close()


def test_create_add_remove_members(db):
    q4 = lists.create(db, "  Q4   dentists ", color="teal")
    assert q4["name"] == "Q4 dentists" and q4["count"] == 0 and q4["color"] == "teal"
    assert lists.add(db, q4["id"], ["A@x.example", "b@x.example", "a@x.example"]) == 2
    assert lists.add(db, q4["id"], ["b@x.example"]) == 0
    assert lists.get(db, q4["id"])["count"] == 2
    assert set(lists.members(db, q4["id"])) == {"a@x.example", "b@x.example"}
    assert lists.remove(db, q4["id"], ["a@x.example"]) == 1
    assert lists.lists_for(db, "b@x.example")[0]["name"] == "Q4 dentists"
    assert lists.lists_for_many(db, ["b@x.example", "zz@x.example"])["zz@x.example"] == []
    kinds = [r["kind"] for r in activity.timeline(db, "contact", "a@x.example")]
    assert kinds[:2] == ["list_remove", "list_add"]


def test_names_unique_per_kind_and_validation(db):
    lists.create(db, "Austin")
    lists.create(db, "Austin", kind="companies")         # same name, other kind: fine
    with pytest.raises(ValueError):
        lists.create(db, "austin")                         # case-insensitive clash
    with pytest.raises(ValueError):
        lists.create(db, "   ")
    with pytest.raises(ValueError):
        lists.create(db, "x", kind="bogus")
    assert lists.ensure(db, "Austin")["kind"] == "people"
    assert len(lists.all_lists(db)) == 2 and len(lists.all_lists(db, "companies")) == 1


def test_update_and_delete(db):
    a = lists.create(db, "A")
    lists.create(db, "B")
    with pytest.raises(ValueError):
        lists.update(db, a["id"], name="b")
    upd = lists.update(db, a["id"], name="Renamed", description="d", color="nope")
    assert upd["name"] == "Renamed" and upd["description"] == "d" and upd["color"] == ""
    lists.add(db, a["id"], ["x@y.example"])
    assert lists.delete(db, a["id"]) is True and lists.get(db, a["id"]) is None
    assert db.scalar("SELECT COUNT(*) FROM list_members") == 0
    assert lists.delete(db, 999) is False and lists.get(db, "nope") is None
