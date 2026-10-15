"""Seniority/department filters parsed from plain English."""
import pytest

from openleads.intent import role_filters, rule_parse


@pytest.mark.parametrize("text,sen,dep", [
    ("VPs of marketing at fintech companies", ["vp"], ["marketing"]),
    ("marketing directors in Austin", ["director"], ["marketing"]),
    ("heads of sales at SaaS startups", ["head"], ["sales"]),
    ("engineering managers in Berlin", ["manager"], ["engineering"]),
    ("C-level executives at logistics companies", ["owner", "founder", "c_suite"], []),
    ("CTOs at YC startups", ["founder", "c_suite"], ["engineering"]),
    ("recruiters at agencies in London", [], ["hr"]),
    # no filters: local / business searches stay unfiltered
    ("marketing agencies in Miami", [], []),
    ("property managers in Austin", [], []),
    ("salon owners in Miami", [], []),
    ("dentists in Austin", [], []),
    ("fintech founders, verified only", [], []),
    ("rust developers in Berlin", [], []),
])
def test_role_filters(text, sen, dep):
    s, d, _ = role_filters(text)
    assert (s, d) == (sen, dep)


def test_rule_parse_sets_filters_and_strips_them_from_keyword():
    q = rule_parse("VPs of marketing at fintech companies")
    assert q.seniority == ["vp"] and q.department == ["marketing"]
    assert "vps" not in (q.keyword or "") and "marketing" not in (q.keyword or "")
    assert "fintech" in (q.keyword or "")
    q2 = rule_parse("marketing agencies in Miami")
    assert q2.seniority == [] and q2.department == []
    assert q2.location == "Miami"


def test_llm_parse_keeps_original_text_and_filters(monkeypatch):
    from openleads import intent
    monkeypatch.setattr(intent, "openrouter_key", lambda: "k")
    monkeypatch.setattr(intent, "llm_parse", lambda text: intent._query_from_dict(
        {"keyword": "dentist", "count": 5, "seniority": ["owner", "bogus"],
         "department": "medical"}))
    q, mode = intent.parse("dental practice owners in Austin")
    assert mode == "llm"
    assert q.text == "dental practice owners in Austin"
    assert q.location == "Austin"
    assert q.seniority == ["owner"] and q.department == ["medical"]
