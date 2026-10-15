"""Deals pipeline."""
import pytest

from openleads.db import DB
from openleads.workspace import activity, companies, deals, people


@pytest.fixture
def db(tmp_path):
    d = DB(tmp_path / "w.db")
    d.upsert_lead({"email": "jane@acme.example", "first_name": "Jane", "organization": "Acme"})
    yield d
    d.close()


def test_create_board_and_forecast(db):
    a = deals.create(db, "Acme pilot", contact="Jane@Acme.example", amount="$12,000")
    deals.create(db, "Beta rollout", account="beta.example", stage="proposal", amount=20000)
    deals.create(db, "Old deal", stage="lost", amount=5000)
    assert a["account"] == "acme.example" and a["amount"] == 12000.0
    assert a["account_name"] == "Acme" and a["contact_name"] == "Jane"
    b = deals.board(db)
    cols = {c["key"]: c for c in b["columns"]}
    assert cols["qualify"]["count"] == 1 and cols["qualify"]["weighted"] == 1200.0
    assert cols["proposal"]["weighted"] == 10000.0
    t = b["totals"]
    assert (t["open_count"], t["open_value"], t["weighted"]) == (2, 32000.0, 11200.0)
    assert t["win_rate"] == 0.0 and t["lost_count"] == 1
    assert deals.forecast(db) == 11200.0
    assert [d["name"] for d in deals.list_deals(db, q="beta")] == ["Beta rollout"]


def test_move_to_won_marks_customers(db):
    d = deals.create(db, "Acme pilot", contact="jane@acme.example", amount=1000)
    moved = deals.move(db, d["id"], "won")
    assert moved["stage"] == "won" and moved["closed"]
    assert people.get(db, "jane@acme.example")["stage"] == "customer"
    assert companies.get(db, "acme.example")["stage"] == "customer"
    assert deals.board(db)["totals"]["win_rate"] == 100.0
    kinds = [r["kind"] for r in activity.timeline(db, "contact", "jane@acme.example")]
    assert "deal_stage" in kinds and "deal_created" in kinds
    assert deals.move(db, d["id"], "negotiation")["closed"] is None
    with pytest.raises(ValueError):
        deals.move(db, d["id"], "celebrating")
    assert deals.move(db, 999, "won") is None


def test_update_validation_and_delete(db):
    d = deals.create(db, "X", amount=10)
    u = deals.update(db, d["id"], {"amount": "2.5k", "close_date": "2026-12-31",
                                   "stage": "meeting", "hacked": 1})
    assert u["amount"] == 2500.0
    assert u["close_date"] == "2026-12-31" and u["stage"] == "meeting"
    with pytest.raises(ValueError):
        deals.update(db, d["id"], {"close_date": "next week"})
    with pytest.raises(ValueError):
        deals.update(db, d["id"], {"amount": "lots"})
    assert deals.update(db, d["id"], {"amount": "1.2m"})["amount"] == 1200000.0
    assert deals.update(db, d["id"], {"amount": "900 USD"})["amount"] == 900.0
    with pytest.raises(ValueError):
        deals.create(db, "  ")
    with pytest.raises(ValueError):
        deals.create(db, "Y", stage="dreaming")
    assert deals.delete(db, d["id"]) and deals.get(db, d["id"]) is None
