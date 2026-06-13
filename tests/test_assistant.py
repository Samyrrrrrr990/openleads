"""The natural-language assistant: time/goal/audience parsing + Action shape (no key)."""
import pytest

from openleads import assistant
from openleads.assistant import Action, action_from_dict, parse_goal, parse_time, rule_interpret


@pytest.mark.parametrize("text,expected", [
    ("send at 9am", (9, 0)),
    ("at 9", (9, 0)),
    ("at 2:30pm", (14, 30)),
    ("at 14:00", (14, 0)),
    ("at 12am", (0, 0)),
    ("at 12pm", (12, 0)),
    ("in the morning", (9, 0)),
    ("this afternoon", (13, 0)),
    ("no time here", None),
    # bare am/pm with no "at" must not crash (regression: int('am')).
    ("email founders 9am", (9, 0)),
    ("blast 50 emails 5pm", (17, 0)),
    ("send 30 emails to devs", None),   # '30' / '50' are counts, not times
])
def test_parse_time(text, expected):
    assert parse_time(text) == expected


@pytest.mark.parametrize("text,expected", [
    ("send 50 emails for my dev-tools startup to founders", "my dev-tools startup"),
    ("reach out about our hiring tool to developers", "our hiring tool"),
    ("email founders promoting Acme at 9am", "Acme"),
    ("email founders", ""),
])
def test_parse_goal(text, expected):
    assert parse_goal(text) == expected


def test_rule_interpret_full_campaign():
    act = rule_interpret("send 50 emails to fintech founders for my SaaS at 9am")
    assert act.intent == "campaign"
    assert act.count == 50
    assert act.send_hour == 9 and act.send_minute == 0
    assert act.context == "my SaaS"
    assert "founder" in act.query.lower()
    assert act.source is None   # v4: federation routes (yc/hn); no hard pin


def test_rule_interpret_schedule_intent():
    act = rule_interpret("schedule 100 emails to YC founders every morning")
    assert act.intent == "schedule"
    assert act.count == 100
    assert act.send_hour == 9


def test_rule_interpret_plain_search_is_search():
    act = rule_interpret("find 20 rust developers in Berlin")
    assert act.intent == "search"
    assert act.count == 20
    assert act.source is None   # v4: federation routes (github); no hard pin


def test_rule_interpret_empty_is_unknown():
    assert rule_interpret("").intent == "unknown"


def test_action_summary_readable():
    act = rule_interpret("send 30 emails to developers about our API at 8am")
    s = act.summary()
    assert "30" in s and "08:00" in s


def test_action_from_dict_validates():
    act = action_from_dict({"intent": "campaign", "query": "founders", "count": 40,
                            "send_hour": 9, "context": "X", "verified_only": True})
    assert isinstance(act, Action) and act.count == 40 and act.send_hour == 9
    # Garbage / missing query → None.
    assert action_from_dict({"intent": "campaign"}) is None
    assert action_from_dict("nope") is None


def test_action_from_dict_clamps_bad_hour():
    act = action_from_dict({"query": "x", "send_hour": 99})
    assert act.send_hour is None   # out-of-range hour dropped


def test_interpret_uses_rules_without_key(monkeypatch):
    monkeypatch.setattr(assistant, "openrouter_key", lambda: None)
    act, mode = assistant.interpret("send 10 emails to founders at 9am")
    assert mode == "rule" and act.count == 10
