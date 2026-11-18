"""The workflow editor's "Describe it" box: a sentence in, a valid graph out."""
from __future__ import annotations

import pytest

from openleads.automate.workflow import describe, graph


def _kinds(wf):
    return [n["type"] for n in wf["nodes"]]


def _ok(wf):
    return [p for p in graph.validate(wf, check_name=False) if p["level"] == "error"] == []


def test_find_write_send_add_to_list():
    out = describe.draft("every weekday at 9am find 20 dentists in Toronto, write emails, "
                         "send them and add them to list Dentists")
    wf = out["workflow"]
    assert _kinds(wf) == ["trigger.schedule", "find", "split_tier", "dedupe", "write",
                          "send", "add_to_list"]
    assert wf["nodes"][0]["params"]["schedule"] == "weekdays 09:00"
    assert wf["nodes"][1]["params"]["count"] == 20
    assert wf["nodes"][-1]["params"]["list"] == "Dentists"
    assert _ok(wf)
    # wired in a line, through the splitter's "safe" port
    assert any(e["from_port"] == "safe" for e in wf["edges"])
    assert len(wf["edges"]) == len(wf["nodes"]) - 1


@pytest.mark.parametrize("said,stage", [("interested stage", "interested"),
                                        ("meeting booked", "meeting"),
                                        ("not interested", "not_interested")])
def test_reply_trigger_and_stage_names(said, stage):
    wf = describe.draft(f"when someone replies, move them to {said} and notify me")["workflow"]
    assert _kinds(wf) == ["trigger.reply", "set_stage", "notify"]
    assert wf["nodes"][1]["params"]["stage"] == stage
    assert _ok(wf)


def test_list_source_before_a_colon():
    wf = describe.draft("people in list Plumbers: verify, then enroll them in sequence Intro")["workflow"]
    assert _kinds(wf) == ["trigger.manual", "contacts", "verify", "enroll"]
    assert wf["nodes"][1]["params"]["list"] == "Plumbers"
    assert wf["nodes"][3]["params"]["sequence"] == "Intro"
    assert _ok(wf)


def test_daily_find_and_export():
    wf = describe.draft("daily at 8 find 50 roofers in Austin and export to csv")["workflow"]
    assert _kinds(wf) == ["trigger.schedule", "find", "export"]
    assert wf["nodes"][0]["params"]["schedule"] == "daily 08:00"
    assert wf["nodes"][2]["params"]["sink"] == "csv"


def test_nothing_past_the_trigger_says_so():
    out = describe.draft("hello there")
    assert _kinds(out["workflow"]) == ["trigger.manual"]
    assert out["skipped"]


def test_empty_is_an_error():
    with pytest.raises(ValueError):
        describe.draft("   ")


def test_from_sentence_falls_back_quietly(monkeypatch):
    out = describe.from_sentence("hello there", use_model=False)
    assert out["workflow"]["nodes"]
