"""Template rendering, spintax and storage."""
from datetime import datetime

import pytest

from openleads.db import DB
from openleads.workspace import templates as T

CONTACT = {"email": "jane@acme.example", "first_name": "Jane", "last_name": "Doe",
           "title": "VP of Sales", "organization": "Acme", "city": "Austin",
           "phone": "+15125550100"}
SENDER = {"sender_name": "Sam", "sender_org": "OpenLeads", "sender_context": "We find leads."}


def test_variables_fallbacks_aliases():
    vals = T.context_for(CONTACT, SENDER, now=datetime(2026, 10, 15))
    out, missing = T.render("Hi {{first_name}} at {{ Company }} ({{firstname}}), "
                            "{{industry | your space}}. {{day}} {{phone}}", vals)
    assert out == "Hi Jane at Acme (Jane), your space. Thursday +1 512-555-0100"
    assert missing == []


def test_missing_variables_are_reported_and_tidied():
    vals = T.context_for({"email": "x@y.example"}, {"sender_name": "Sam"})
    out, missing = T.render("Hi {{first_name}}, about {{company}} .", vals)
    assert out == "Hi, about."
    assert missing == ["first_name", "company"]


def test_spintax_is_deterministic_per_seed():
    a, _ = T.render("{Hi|Hey|Hello} there {a|{b|c}}", {}, seed="jane@acme.example")
    b, _ = T.render("{Hi|Hey|Hello} there {a|{b|c}}", {}, seed="jane@acme.example")
    assert a == b and "{" not in a
    picks = {T.render("{1|2|3|4|5|6}", {}, seed=f"s{i}")[0] for i in range(40)}
    assert len(picks) > 3


def test_render_draft_lints_and_reports():
    d, missing = T.render_draft("quick question for {{company}}",
                                "Hi {{first_name|there}},\n\n{{sender_context}}\n\n{{sender_name}}",
                                CONTACT, SENDER)
    assert d.email == "jane@acme.example" and d.subject == "quick question for Acme"
    assert d.body.startswith("Hi Jane,") and "We find leads." in d.body
    assert d.model == "template" and "score" in d.lint and missing == []


def test_unknown_variables_detected():
    assert T.unknown_variables("Hi {{first_name}} {{favorite_color}} {{Company}}") == [
        "favorite_color"]


@pytest.fixture
def db(tmp_path):
    d = DB(tmp_path / "w.db")
    yield d
    d.close()


def test_defaults_seed_once_and_crud(db):
    starters = T.list_templates(db)
    assert len(starters) == len(T.DEFAULTS)
    for t in starters:                                       # every starter is valid
        assert T.unknown_variables(t["subject"] + t["body"]) == []
    for t in starters:
        T.delete(db, t["id"])
    assert T.list_templates(db) == []                        # not re-seeded
    t = T.create(db, "Mine", "hi {{first_name}}", "Body {{company}}", "intro")
    with pytest.raises(ValueError):
        T.create(db, "mine", "x", "y")
    with pytest.raises(ValueError):
        T.create(db, "Other", "x", "{{shoe_size}}")
    with pytest.raises(ValueError):
        T.create(db, "Empty", "x", "  ")
    u = T.update(db, t["id"], {"subject": "hello {{first_name}}", "id": 99})
    assert u["subject"] == "hello {{first_name}}" and u["id"] == t["id"]
    T.mark_used(db, t["id"], 3)
    assert T.get(db, "Mine")["used"] == 3
    assert T.list_templates(db, "intro")[0]["name"] == "Mine"
    assert T.delete(db, t["id"]) and not T.delete(db, t["id"])
