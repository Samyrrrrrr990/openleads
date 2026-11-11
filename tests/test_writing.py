"""The email writer: research brief, keyless composer, LLM path, quality gate, rewrites."""
import json
import re

import pytest

from openleads import settings
from openleads.models import Lead
from openleads.writing import (
    brief_for,
    build_brief,
    generate_template,
    improve_template,
    quality,
    rewrite,
    score_draft,
    write_email,
)
from openleads.writing import llm as llmmod
from openleads.writing.quality import facts_check, reading_grade

SENDER = {"sender_name": "Sam", "sender_org": "Slotfill",
          "sender_context": "We help clinics fill empty appointment slots from their waitlist."}

DENTIST = Lead(first_name="Maya", last_name="Okafor", email="maya@northwind.example",
               title="Owner & Lead Dentist", organization="Northwind Dental", industry="Dental",
               employees="24", city="Austin", country="US", source="local",
               technologies=["WordPress", "Zocdoc", "Google Analytics", "Google Fonts"],
               description="Gentle family dentistry with Saturday hours and same-day crowns.",
               signals={"groundtruth_exact": True})
YC = Lead(first_name="Lucas", last_name="Ferreira", email="lucas@heliopay.example",
          title="VP of Sales", organization="Helio Payments", industry="Fintech", source="yc",
          employees="260", technologies=["Stripe", "Segment"])
HIRING_INBOX = Lead(email="jobs@acme.example", title="Hiring", organization="Acme", source="hn",
                    vertical="companies hiring")
DEV = Lead(first_name="Linus", email="linus@rust.example", source="github",
           title="Building fast things in Rust | ex-Google", vertical="developers")
BARE = {"email": "pat@unknown.example", "first_name": "pat"}
FIXTURES = [DENTIST, YC, HIRING_INBOX, DEV, BARE,
            {"email": "info@northwind.example", "name": "Northwind Dental",
             "organization": "Northwind Dental", "industry": "Dental", "city": "Austin"},
            Lead(first_name="Ada", last_name="L", email="ada@uni.example", title="Researcher",
                 organization="University of Somewhere", source="openalex").to_dict()]


@pytest.fixture(autouse=True)
def home(monkeypatch, tmp_path):
    monkeypatch.setenv("OPENLEADS_HOME", str(tmp_path))
    for k in ("OPENROUTER_API_KEY", "OPENLEADS_AI_BASE_URL", "OPENLEADS_AI_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    for k, v in SENDER.items():
        settings.set(k, v)
    yield tmp_path


# --- brief -------------------------------------------------------------------- #
def test_brief_collects_what_we_know():
    b = brief_for(DENTIST)
    keys = {f.key for f in b.facts}
    assert {"company.description", "company.tech", "company.size", "company.location",
            "person.title"} <= keys
    assert b.kind == "person" and b.first_name == "Maya" and b.role == "leader"
    assert b.vertical == "dental" and b.local_business
    # fonts aren't worth mentioning; scheduling tools are
    assert "Google Fonts" not in b.fact("company.tech").value
    assert "Zocdoc" in b.fact("company.tech").value
    assert b.topic == "bookings" and b.evidence == "found"
    assert b.sender["pitch"].startswith("We help clinics")


def test_brief_signals_from_the_source():
    assert brief_for(YC).signal("yc")
    hn = brief_for(HIRING_INBOX)
    assert hn.signal("hiring") and hn.kind == "company" and hn.first_name == ""
    dev = brief_for(DEV)
    assert dev.title == "" and dev.bio.startswith("Building fast things")   # a bio, not a title
    assert dev.signal("github")


def test_brief_never_greets_a_company_by_its_first_word():
    b = brief_for({"email": "office@northwind.example", "name": "Northwind Dental",
                   "organization": "Northwind Dental"})
    assert b.kind == "company" and b.first_name == ""
    b2 = brief_for({"email": "hello@x.example", "first_name": "Hello", "organization": "X"})
    assert b2.kind == "company" and b2.first_name == ""


def test_brief_reads_workspace_rows_with_json_data():
    row = {"email": "maya@northwind.example", "name": "Maya Okafor", "organization": "Northwind",
           "data": json.dumps(DENTIST.to_dict()), "first_name": "Maya", "title": ""}
    b = brief_for(row)
    assert b.has("company.tech") and b.title == "Owner & Lead Dentist"


def test_build_brief_is_pure_and_flags_gaps():
    b = build_brief(BARE, {})
    assert b.first_name == "Pat"
    assert any("No pitch" in g for g in b.gaps)
    assert any("Nothing specific" in g for g in b.gaps)


# --- keyless writer ------------------------------------------------------------- #
def test_writes_are_deterministic_per_lead_and_varied_across_leads():
    a1, a2 = write_email(DENTIST), write_email(DENTIST)
    assert (a1.subject, a1.body) == (a2.subject, a2.body)
    people = [Lead(first_name=n, email=f"{n.lower()}@heliopay.example", title=t,
                   organization="Helio Payments", source="yc", technologies=["Stripe", "Segment"])
              for n, t in (("Amara", "CTO"), ("Ben", "Account Executive"), ("Nina", "Head of People"),
                           ("Grace", "Director of Marketing"), ("Lucas", "VP of Sales"))]
    bodies = {write_email(p).body.split("\n", 1)[1] for p in people}
    assert len(bodies) >= 4          # same company, different copy


@pytest.mark.parametrize("lead", FIXTURES)
@pytest.mark.parametrize("angle", [None, "mutual-signal", "compliment", "curiosity", "pain",
                                   "short-ask"])
@pytest.mark.parametrize("tone", ["plain", "casual"])
def test_keyless_never_invents_facts(lead, angle, tone):
    d = write_email(lead, angle=angle, tone=tone, llm=False)
    b = brief_for(lead)
    assert facts_check(d.subject, d.body, b) == [], (d.subject, d.body)
    assert "{" not in d.body and "[" not in d.body
    assert d.lint["ok"] and d.quality["score"] >= 60
    assert (20 if d.angle in ("short-ask", "inbox") else 25) <= d.quality["words"] <= 130


def test_first_email_uses_the_brief_and_explains_itself():
    d = write_email(DENTIST, variants=1)
    assert d.body.startswith("Hi Maya,")
    assert d.quality["personalization"]["count"] >= 2
    assert d.quality["score"] >= 80 and 50 <= d.quality["words"] <= 120
    slots = [x["slot"] for x in d.explain]
    assert {"writer", "angle", "opener", "value", "ask", "subject"} <= set(slots)
    assert "Sam" in d.body and "fill empty appointment slots" in d.body
    assert d.brief["facts"] and d.model == "writer"


def test_mutual_signal_leads_with_the_signal():
    d = write_email(YC)
    assert d.angle == "mutual-signal" and "Y Combinator" in d.body
    assert "Congrats on getting" not in d.body       # he's VP Sales, not the founder


def test_company_contact_gets_who_should_i_talk_to():
    d = write_email({"email": "info@northwind.example", "name": "Northwind Dental",
                     "organization": "Northwind Dental", "industry": "Dental"})
    assert d.angle == "inbox"
    assert d.body.startswith("Hi Northwind Dental team,")
    assert re.search(r"right person|pass this along|best person", d.body)
    assert not any(r["code"] in ("greeting", "inbox") for r in d.quality["reasons"])
    hn = write_email(HIRING_INBOX)
    assert "hiring" in hn.body.lower() and hn.first_name == ""


def test_variants_are_different_and_scored():
    d = write_email(DENTIST, variants=3)
    assert len(d.variants) == 3
    assert len({v["body"] for v in d.variants}) == 3
    assert all(v["quality"]["score"] for v in d.variants)
    assert d.variants[0]["body"] == d.body


def test_bad_angle_is_an_error_and_unavailable_angle_falls_back():
    with pytest.raises(ValueError):
        write_email(DENTIST, angle="flattery")
    d = write_email(BARE, angle="compliment")       # nothing to compliment
    assert d.angle != "compliment"
    assert "needs facts" in next(x["why"] for x in d.explain if x["slot"] == "angle")


def test_follow_ups_thread_and_never_repeat():
    first = write_email(DENTIST)
    second = write_email(DENTIST, step=2)
    assert second.subject == "re: " + first.subject
    first_sents = {s.strip() for s in re.split(r"(?<=[.?!])\s+|\n+", first.body) if len(s.split()) > 5}
    assert not any(s.strip() in first_sents for s in re.split(r"(?<=[.?!])\s+|\n+", second.body)
                   if len(s.split()) > 5)
    assert not any(r["code"] == "repeat" for r in second.quality["reasons"])
    third = write_email(DENTIST, step=3, thread_subject="original subject")
    assert third.subject == "re: original subject" and "?" in third.body
    last = write_email(DENTIST, step=4, final=True)
    assert last.angle == "breakup" and "close the loop" in last.body.lower() \
        or "timing" in last.body.lower()
    assert last.quality["score"] >= 80
    inbox2 = write_email(HIRING_INBOX, step=2)
    assert "right" in inbox2.body.lower() or "best person" in inbox2.body.lower()


def test_writers_module_entry_point_is_stable():
    from openleads import writers
    d = writers.write_email(DENTIST.to_dict(), angle=None, step=1, settings=None, variants=1, llm=None)
    assert d.subject and d.quality["score"] >= 0
    from openleads.outreach import compose
    assert compose.draft(DENTIST.to_dict()).body == d.body


def test_compose_draft_honours_sequence_pitch_override():
    # v5.1 bug: {"sender_context": …} overrides were ignored and every draft said
    # "We're reaching out about a potential collaboration."
    from openleads.outreach import compose
    d = compose.draft(YC.to_dict(), {"sender_context": "We audit payment flows for leaks."})
    assert "We audit payment flows for leaks." in d.body
    d2 = compose.draft(YC.to_dict(), {"context": "We build hiring funnels."})
    assert "We build hiring funnels." in d2.body


# --- quality gate --------------------------------------------------------------- #
def test_quality_flags_what_hurts():
    b = brief_for(DENTIST)
    bad = score_draft(
        "FREE OFFER!!!", "Hey Northwind,\n\nI hope this email finds you well. As we discussed, "
        "I wanted to reach out. Click here https://a.example https://b.example for a free "
        "guarantee. {{first_name}} see the attached PDF.\n\nBest", b)
    codes = {r["code"] for r in bad["reasons"]}
    assert {"spam", "variables", "links", "attachment", "familiarity", "generic", "greeting",
            "personal", "ask"} <= codes
    assert bad["score"] < 30 and bad["grade"] == "weak"
    good = write_email(DENTIST).quality
    assert good["score"] > 80 and good["grade"] == "good"


def test_reading_grade_and_template_mode():
    assert reading_grade("Hi Ann,\n\nWe fix leaks. Want to see?\n\nSam") < 6
    q = score_draft("hi {{first_name}}", "{Hi|Hey} {{first_name|there}},\n\nWorth a chat?", None,
                    template=True)
    assert not any(r["code"] in ("variables", "placeholder") for r in q["reasons"])


def test_facts_check_catches_inventions():
    b = brief_for(DENTIST)
    problems = facts_check("congrats", "Congrats on the Series B. We helped 40 practices and "
                           "saw you use HubSpot. Big fan of your work.", b)
    text = " ".join(problems)
    assert "Series" in text and "40" in text and "HubSpot" in text and "familiarity" in text
    assert facts_check("x", "Saw Northwind Dental uses Zocdoc in Austin. 15-minute call?", b) == []


# --- LLM path (fake HTTP, never the network) ---------------------------------------- #
def _fake_http(reply, calls=None):
    def http(url, payload, headers, timeout):
        if calls is not None:
            calls.append({"url": url, "payload": payload, "headers": headers, "timeout": timeout})
        if isinstance(reply, Exception):
            raise reply
        return {"choices": [{"message": {"content": reply if isinstance(reply, str)
                                         else json.dumps(reply)}}]}
    return http


GOOD_LLM = {"subject": "zocdoc and empty chairs",
            "body": "Hi Maya,\n\nSaw Northwind Dental books through Zocdoc and runs Saturday hours. "
                    "Gaps from late cancellations are hard to refill by phone. We help clinics fill "
                    "empty appointment slots from their waitlist, so a cancelled crown prep becomes "
                    "a filled chair instead of a quiet hour. Would a 15-minute call next week "
                    "be worth it?\n\nBest,\nSam",
            "variants": [{"subject": "saturday hours",
                          "body": "Hi Maya,\n\nNoticed Northwind Dental offers Saturday hours. We "
                                  "help clinics fill empty appointment slots from their waitlist, "
                                  "which matters most on the busiest days of the week. Open to a "
                                  "short call to see if it fits your front desk?\n\nBest,\nSam"}]}


def test_llm_path_uses_the_brief_and_returns_json_drafts():
    settings.set("openrouter_api_key", "sk-test")
    calls = []
    d = write_email(DENTIST, variants=2, http=_fake_http(GOOD_LLM, calls))
    assert d.model == "openai/gpt-oss-120b:free" and d.subject == "zocdoc and empty chairs"
    assert len(d.variants) == 2 and d.variants[1]["subject"] == "saturday hours"
    sent = calls[0]
    assert sent["url"] == llmmod.OPENROUTER_URL and sent["headers"]["Authorization"] == "Bearer sk-test"
    system, user = sent["payload"]["messages"]
    assert "Use ONLY facts from the BRIEF" in system["content"]
    task = json.loads(user["content"])
    assert any(f["key"] == "company.tech" for f in task["brief"]["facts"])
    assert d.quality["score"] >= 70


def test_llm_custom_endpoint_without_key(monkeypatch):
    settings.set("ai_base_url", "http://localhost:11434/v1")
    settings.set("ai_model", "llama3")
    calls = []
    d = write_email(DENTIST, http=_fake_http(GOOD_LLM, calls))
    assert calls[0]["url"] == "http://localhost:11434/v1/chat/completions"
    assert "Authorization" not in calls[0]["headers"] and calls[0]["payload"]["model"] == "llama3"
    assert d.model == "llama3"


@pytest.mark.parametrize("reply", [TimeoutError("timed out"), OSError("refused"), "not json",
                                   {"subject": "", "body": ""}, {"choices": []}])
def test_llm_failure_falls_back_to_keyless(reply):
    settings.set("openrouter_api_key", "sk-test")
    keyless = write_email(DENTIST, llm=False)
    d = write_email(DENTIST, http=_fake_http(reply))
    assert d.model == "writer" and d.body == keyless.body
    why = d.explain[0]["why"]
    assert "not used" in why


def test_llm_draft_with_invented_facts_is_rejected():
    settings.set("openrouter_api_key", "sk-test")
    invented = {"subject": "congrats on the raise",
                "body": "Hi Maya,\n\nCongrats on Northwind Dental's Series A! We helped 37 practices "
                        "like yours grow 42% with HubSpot. Worth a call?\n\nBest,\nSam"}
    d = write_email(DENTIST, http=_fake_http(invented))
    assert d.model == "writer"
    assert "rejected" in d.explain[0]["why"]


def test_llm_off_setting_and_flag():
    settings.set("openrouter_api_key", "sk-test")
    calls = []
    write_email(DENTIST, llm=False, http=_fake_http(GOOD_LLM, calls))
    settings.set("writing_llm", "off")
    write_email(DENTIST, http=_fake_http(GOOD_LLM, calls))
    assert calls == []


def test_llm_follow_up_keeps_the_thread():
    settings.set("openrouter_api_key", "sk-test")
    reply = {"subject": "something new", "body": "Hi Maya,\n\nOne more thought: Saturday hours "
             "are usually the hardest to refill. Want me to send a short overview?\n\nBest,\nSam"}
    calls = []
    first = write_email(DENTIST, llm=False)
    d = write_email(DENTIST, step=2, http=_fake_http(reply, calls))
    assert d.subject == "re: " + first.subject
    task = json.loads(calls[0]["payload"]["messages"][1]["content"])
    assert task["earlier_emails_in_thread"][0]["body"] == first.body


# --- rewrites + templates --------------------------------------------------------- #
def test_rewrites_are_rule_based_without_an_llm():
    d = write_email(DENTIST, tone="warm")
    short = rewrite(d, "shorter", DENTIST)
    assert short.quality["words"] < d.quality["words"] and "?" in short.body
    casual = rewrite(d, "more casual", DENTIST)
    assert casual.body.startswith("Hey Maya,") and "Cheers," in casual.body
    direct = rewrite({"subject": "x", "body": "Hi Maya,\n\nI think we could maybe help. Would you "
                      "be open to a short chat?\n\nBest,\nSam"}, "more direct", DENTIST)
    assert "maybe" not in direct.body and "15 minutes this week?" in direct.body
    warm = rewrite(write_email(DENTIST, tone="direct"), "warmer", DENTIST)
    assert "Thanks so much," in warm.body
    for r in (short, casual, direct, warm):
        assert facts_check(r.subject, r.body, brief_for(DENTIST)) == []
    with pytest.raises(ValueError):
        rewrite(d, "louder", DENTIST)


def test_llm_rewrite_falls_back_when_it_invents():
    settings.set("openrouter_api_key", "sk-test")
    d = write_email(DENTIST, llm=False)
    bad = {"subject": d.subject, "body": d.body + "\nWe doubled revenue for 37 clinics."}
    out = rewrite(d, "shorter", DENTIST, http=_fake_http(bad))
    assert out.model == "writer" and "rule-based" in out.explain[0]["why"]


def test_generate_template_uses_variables_only():
    from openleads.workspace.templates import unknown_variables
    for angle in (None, "curiosity", "pain", "short-ask", "compliment"):
        t = generate_template(angle=angle)
        assert "{{first_name|there}}" in t["body"] and "{{sender_context}}" in t["body"]
        assert unknown_variables(t["subject"] + t["body"]) == []
        assert "Northwind" not in t["body"]
    assert "AI-write" in generate_template(angle="compliment")["note"]
    fu = generate_template(step=2)
    assert fu["subject"].startswith("re: ")
    bye = generate_template(step=3, final=True)
    assert "loop" in bye["body"] or "timing" in bye["body"]


def test_improve_template_fixes_and_keeps_variables():
    out = improve_template("ACT NOW: FREE DEMO!!!",
                           "Hi {{first_name}},\n\nI hope this email finds you well. Our amazing tool "
                           "is guaranteed to increase sales. Click here https://a.example "
                           "https://b.example\n\n{{sender_name}}")
    assert "{{first_name|there}}" in out["body"] and "{{sender_name}}" in out["body"]
    low = (out["subject"] + out["body"]).lower()
    for word in ("free", "amazing", "guaranteed", "increase sales", "click here", "act now",
                 "finds you well", "b.example"):
        assert word not in low
    assert "?" in out["body"] and out["quality"]["score"] > out["before"]
    assert out["changes"]


# --- sequences + templates use the writer -------------------------------------------- #
def test_sequence_ai_steps_follow_up_in_thread_with_the_sequence_pitch(tmp_path):
    from openleads.db import DB
    from openleads.workspace import sequences as S
    db = DB(tmp_path / "w.db")
    db.upsert_lead(YC.to_dict())
    lead = db.get_lead(YC.email)
    seq = S.create(db, "AI", [{"type": "auto_email", "ai": True},
                              {"type": "auto_email", "ai": True, "delay_days": 3, "thread": True,
                               "angle": "curiosity"},
                              {"type": "call", "delay_days": 2, "note": "call"},
                              {"type": "auto_email", "ai": True, "delay_days": 4, "thread": True}],
                   {"context": "We audit payment flows for leaks."})
    assert seq["steps"][1]["angle"] == "curiosity"
    enr = {"email": YC.email, "thread_subject": ""}
    d1, _, _ = S._draft_for(db, seq, seq["steps"][0], enr, lead)
    assert "We audit payment flows for leaks." in d1.body and d1.step == 1
    enr["thread_subject"] = d1.subject
    d2, _, _ = S._draft_for(db, seq, seq["steps"][1], enr, lead)
    assert d2.subject == "re: " + d1.subject and d2.step == 2
    assert "We audit payment flows" not in d2.body          # a follow-up, not the intro again
    d3, _, _ = S._draft_for(db, seq, seq["steps"][3], enr, lead)
    assert d3.angle == "breakup" and d3.step == 3
    db.close()


def test_templates_never_greet_a_company_by_its_first_word():
    from openleads.outreach.sequences import followup_draft
    from openleads.workspace import templates as T
    inbox = {"email": "info@northwind.example", "name": "Northwind Dental",
             "organization": "Northwind Dental"}
    d, _ = T.render_draft("hi", "Hi {{first_name|there}},\n\nWorth a chat?", inbox)
    assert d.body.startswith("Hi there,") and "quality" in d.to_dict()
    f = followup_draft(inbox, 2, sender="Sam")
    assert "Northwind," not in f.body and f.subject.startswith("re: ")


# --- copy rules: no long dashes, 110 to 125 words, nothing generic ------------- #
@pytest.fixture
def demo_leads(tmp_path):
    from openleads import demo
    from openleads.db import DB
    db = DB(tmp_path / "demo.db")
    try:
        demo.seed(db)
        return [dict(r) for r in db.query("SELECT * FROM leads ORDER BY email LIMIT 12")]
    finally:
        db.close()


def test_dash_costs_points():
    r = quality.score_draft("hi", "We help teams — fast.")
    assert any(x["code"] == "dash" and x["impact"] == -10 for x in r["reasons"])
    assert any(x["code"] == "dash" for x in quality.score_draft("a – b", "fine")["reasons"])


def test_vacuous_line_costs_points():
    r = quality.score_draft("hi", "I came across your profile and wanted to reach out.")
    assert any(x["code"] == "vacuous" and x["impact"] == -8 for x in r["reasons"])
    r = quality.score_draft("hi", "I HOPE THIS EMAIL FINDS YOU WELL.")
    assert any(x["code"] == "vacuous" for x in r["reasons"])


def test_first_email_over_125_words_is_long():
    body = " ".join(["word"] * 130) + "."
    r = quality.score_draft("quick question", body, step=1)
    long_ = [x for x in r["reasons"] if x["code"] == "long"]
    assert long_ and "110 to 125" in " ".join(x["message"] for x in long_)
    assert not any(x["code"] == "long" for x in
                   quality.score_draft("q", " ".join(["word"] * 124) + ".", step=1)["reasons"])


def test_reason_messages_have_no_long_dashes():
    for body in ("short.", " ".join(["word"] * 200)):
        r = quality.score_draft("hi", body)
        assert not any("–" in x["message"] or "—" in x["message"] for x in r["reasons"])


def test_dashes_helper():
    from openleads import writing
    assert writing.dashes("fast — and cheap") == "fast, and cheap"
    assert writing.dashes("2019–2024") == "2019,2024"
    assert writing.dashes("no dash here") == "no dash here"


def test_writer_never_emits_dashes_or_vacuous_lines(demo_leads):
    scores = []
    for lead in demo_leads:
        for angle in ("mutual-signal", "compliment", "curiosity", "pain", "short-ask"):
            d = write_email(lead, angle=angle, llm=False)
            assert "—" not in d.subject + d.body and "–" not in d.subject + d.body
            assert not any(r["code"] == "vacuous" for r in d.quality["reasons"])
            scores.append(d.quality["score"])
    assert sum(scores) / len(scores) >= 95
