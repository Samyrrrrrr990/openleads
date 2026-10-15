"""Contact tags."""
import pytest

from openleads.db import DB
from openleads.workspace import activity, tags


@pytest.fixture
def db(tmp_path):
    d = DB(tmp_path / "w.db")
    yield d
    d.close()


def test_add_remove_case_insensitive(db):
    assert tags.add(db, ["A@x.example", "b@x.example"], "Hot, conference ,hot") == 4
    assert tags.add(db, "a@x.example", ["HOT"]) == 0          # already there
    assert tags.for_contact(db, "a@x.example") == ["conference", "Hot"]
    assert tags.all_tags(db) == [{"tag": "conference", "count": 2}, {"tag": "Hot", "count": 2}]
    assert tags.remove(db, ["a@x.example"], ["hot"]) == 1
    assert tags.for_contacts(db, ["a@x.example", "b@x.example"]) == {
        "a@x.example": ["conference"], "b@x.example": ["conference", "Hot"]}
    assert any(r["kind"] == "tag" for r in activity.timeline(db, "contact", "b@x.example"))


def test_set_rename_delete(db):
    tags.set_tags(db, "a@x.example", ["one", "two"])
    assert tags.set_tags(db, "a@x.example", ["two", "three"]) == ["three", "two"]
    tags.add(db, ["b@x.example"], ["two"])
    tags.rename(db, "two", "deux")
    assert tags.for_contact(db, "b@x.example") == ["deux"]
    assert tags.delete(db, "deux") == 2
    assert tags.for_contact(db, "a@x.example") == ["three"]


def test_normalize_and_empty_inputs(db):
    assert tags.normalize("  #big   deal, ") == "big deal"
    assert tags.add(db, [], ["x"]) == 0 and tags.add(db, ["a@x.example"], "") == 0
    assert len(tags.normalize("x" * 99)) == tags.MAX_LEN
