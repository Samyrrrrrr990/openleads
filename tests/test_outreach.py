"""Network-free tests for the outreach engine: compose, sender, sequences, inbox."""


from openleads.models import Draft


# --- compose: spam lint + template draft -----------------------------------
def test_spam_lint_clean_vs_spammy():
    from openleads.outreach.compose import spam_lint
    clean = spam_lint("quick question about acme",
                      "Hey Ada,\n\nLoved your work on X. Open to a short chat?\n\nBest, Sam")
    assert clean["ok"] and clean["score"] < 35

    spammy = spam_lint("FREE MONEY!!! ACT NOW",
                       "Congratulations winner! 100% free guaranteed cash. "
                       "Click here http://x.co http://y.co http://z.co buy now $$$")
    assert not spammy["ok"] and spammy["score"] > 50
    assert spammy["warnings"]


def test_spam_lint_flags_placeholder():
    from openleads.outreach.compose import spam_lint
    out = spam_lint("hi", "Hey [first name], reaching out about {company}.")
    assert any("placeholder" in w for w in out["warnings"])


def test_template_draft_has_greeting_no_placeholder(monkeypatch):
    from openleads.outreach import compose
    cfg = {"sender": "Sam", "org": "Acme", "context": "We build X."}
    subject, body = compose.template_draft(
        {"first_name": "Ada", "organization": "Globex", "title": "CTO"}, cfg)
    assert body.startswith("Hey Ada,")
    assert not compose.has_placeholder(subject + body)


# --- providers: presets ----------------------------------------------------
def test_provider_presets():
    from openleads.outreach.providers import preset
    assert preset("gmail")["smtp_host"] == "smtp.gmail.com"
    assert preset("outlook")["smtp_port"] == 587
    assert preset("unknown")["smtp_host"] == ""  # falls back to custom


# --- sender: message construction ------------------------------------------
def test_build_message_headers():
    from openleads.outreach.sender import build_message
    cfg = {"user": "sam@acme.io"}
    d = Draft(email="ada@globex.com", subject="hello", body="Hey Ada,\n\nbody",
              first_name="Ada")
    msg = build_message(d, cfg)
    assert msg["To"] == "ada@globex.com"
    assert msg["Subject"] == "hello"
    assert "sam@acme.io" in msg["From"]
    assert msg["Message-ID"] and "@acme.io" in msg["Message-ID"]
    assert "mailto:sam@acme.io" in msg["List-Unsubscribe"]
    assert "P.S." in msg.get_content()   # opt-out footer present


def test_send_drafts_dry_run_previews(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENLEADS_HOME", str(tmp_path))
    from openleads.db import DB
    from openleads.outreach.sender import send_drafts
    db = DB(path=str(tmp_path / "ol.db"))
    drafts = [Draft(email="a@x.com", subject="s", body="b"),
              Draft(email="b@x.com", subject="s", body="b")]
    results = send_drafts(drafts, dry_run=True, db=db)
    assert [r.status for r in results] == ["preview", "preview"]
    # dry-run still logs touches for visibility
    assert len(db.touches_for("a@x.com")) == 1
    db.close()


def test_send_drafts_skips_suppressed(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENLEADS_HOME", str(tmp_path))
    from openleads.db import DB
    from openleads.outreach.sender import send_drafts
    db = DB(path=str(tmp_path / "ol.db"))
    db.suppress("a@x.com", "unsubscribed")
    results = send_drafts([Draft(email="a@x.com", subject="s", body="b")],
                          dry_run=True, db=db)
    assert results[0].status == "skipped" and "suppressed" in results[0].detail
    db.close()


# --- sequences: timing logic -----------------------------------------------
def test_next_step_first_when_no_touches():
    from openleads.outreach.sequences import next_step
    assert next_step([]) == 1


def test_next_step_waits_for_delay():
    from openleads.outreach.sequences import DAY, next_step
    now = 1_000_000.0
    touches = [{"status": "sent", "step": 1, "ts": now - 1 * DAY}]
    # step 2 needs 3 days; only 1 has passed
    assert next_step(touches, now=now) is None
    touches = [{"status": "sent", "step": 1, "ts": now - 4 * DAY}]
    assert next_step(touches, now=now) == 2


def test_next_step_exhausted():
    from openleads.outreach.sequences import DAY, DEFAULT_SEQUENCE, next_step
    now = 1_000_000.0
    touches = [{"status": "sent", "step": len(DEFAULT_SEQUENCE), "ts": now - 99 * DAY}]
    assert next_step(touches, now=now) is None


# --- inbox: bounce/reply parsing -------------------------------------------
def test_is_bounce():
    from openleads.outreach.inbox import is_bounce
    assert is_bounce("Mail Delivery System <MAILER-DAEMON@x>", "Undeliverable")
    assert is_bounce("postmaster@x", "Delivery Status Notification (Failure)")
    assert not is_bounce("Ada <ada@globex.com>", "re: your note")


def test_parse_bounced_recipient():
    from openleads.outreach.inbox import parse_bounced_recipient
    raw = ("Your message to ada@globex.com could not be delivered.\n"
           "Reporting-MTA: dns; mailer-daemon@google.com")
    known = {"ada@globex.com"}
    assert parse_bounced_recipient(raw, known) == "ada@globex.com"


# --- deliverability: warmup + preflight scoring ----------------------------
def test_warmup_status_fresh_mailbox(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENLEADS_HOME", str(tmp_path))
    monkeypatch.setenv("CAMPAIGN_MAX", "40")
    from openleads.db import DB
    from openleads.outreach.deliverability import warmup_status
    db = DB(path=str(tmp_path / "ol.db"))
    ws = warmup_status(db)
    assert ws["day"] == 1
    assert ws["allowance"] == 10   # default warmup_start
    assert ws["remaining"] == 10
    db.close()


def test_preflight_scoring(monkeypatch):
    from openleads.outreach import deliverability
    monkeypatch.setattr(deliverability.mx, "dns_health",
                        lambda d, cache=None: {"spf_present": True, "dmarc_present": True,
                                               "dmarc_policy": "reject"})
    monkeypatch.setattr(deliverability, "_has_dkim", lambda d, cache=None: True)
    out = deliverability.preflight("acme.io")
    assert out["grade"] == "A" and out["ready"] and out["score"] == 100
    assert out["fixes"] == []

    monkeypatch.setattr(deliverability.mx, "dns_health",
                        lambda d, cache=None: {"spf_present": False, "dmarc_present": False,
                                               "dmarc_policy": ""})
    monkeypatch.setattr(deliverability, "_has_dkim", lambda d, cache=None: False)
    bad = deliverability.preflight("acme.io")
    assert bad["grade"] == "F" and not bad["ready"] and bad["fixes"]
