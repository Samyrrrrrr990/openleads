"""Notes on contacts, companies and deals."""
import pytest

from openleads.db import DB
from openleads.workspace import activity, notes


@pytest.fixture
def db(tmp_path):
    d = DB(tmp_path / "w.db")
    yield d
    d.close()


def test_add_list_pin_update_delete(db):
    a = notes.add(db, "contact", "Jane@Acme.example", "  Met at SaaStr  ")
    b = notes.add(db, "contact", "jane@acme.example", "Champion is the CFO", pinned=True)
    assert a["body"] == "Met at SaaStr" and a["ref"] == "jane@acme.example"
    assert [n["id"] for n in notes.for_ref(db, "contact", "jane@acme.example")] == [b["id"], a["id"]]
    assert notes.update(db, a["id"], body="Met at SaaStr 2026", pinned=True)["pinned"] == 1
    assert notes.count_for(db, "contact", ["jane@acme.example", "x@y.example"]) == {
        "jane@acme.example": 2, "x@y.example": 0}
    assert notes.delete(db, a["id"]) and not notes.delete(db, a["id"])
    assert activity.timeline(db, "contact", "jane@acme.example")[0]["kind"] == "note"


def test_validation(db):
    with pytest.raises(ValueError):
        notes.add(db, "planet", "x", "hi")
    with pytest.raises(ValueError):
        notes.add(db, "contact", "x@y.example", "   ")
    n = notes.add(db, "deal", 7, "Budget approved")
    assert n["ref"] == "7"
    with pytest.raises(ValueError):
        notes.update(db, n["id"], body=" ")
    assert notes.update(db, 999, body="x") is None
