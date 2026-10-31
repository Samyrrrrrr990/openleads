"""Network-free tests for the Precleared cold-email legality check in the sender."""
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from openleads import settings
from openleads.db import DB
from openleads.models import Draft
from openleads.outreach import precleared, providers, sender

OK = (200, {"verdict": "ok_to_email", "confidence": "high", "reasons": [], "next_step": "",
            "receipt": {"id": "rcpt_ok"}})
CONSENT = (200, {"verdict": "consent_needed",
                 "reasons": [{"rule_key": "uk_sole_trader", "text": "UK sole traders need "
                              "consent before a marketing email.", "source_title": "PECR reg 22"}],
                 "next_step": "Ask for permission first.", "receipt": {"id": "rcpt_consent"}})
UNKNOWN = (200, {"verdict": "unknown", "reasons": [{"note": "Could not tell who owns the domain."}],
                 "next_step": "Confirm the company.", "receipt": {"id": "rcpt_unknown"}})
DOWN = (0, {"error": "connection refused"})


class FakeSMTP:
    def __init__(self):
        self.sent = []

    def send_message(self, msg):
        self.sent.append(msg["To"])

    def quit(self):
        pass


@pytest.fixture
def env(tmp_path, monkeypatch):
    """An isolated home, a mailbox config, no pacing delays and a fake SMTP server."""
    monkeypatch.setenv("OPENLEADS_HOME", str(tmp_path))
    monkeypatch.setenv("SMTP_USER", "me@acme.io")
    monkeypatch.setenv("SMTP_PASS", "pw")
    monkeypatch.setenv("SMTP_HOST", "mail.acme.io")
    monkeypatch.setenv("CAMPAIGN_CONTEXT", "We build billing software for clinics.")
    monkeypatch.delenv("PRECLEARED_MODE", raising=False)
    monkeypatch.delenv("PRECLEARED_API_KEY", raising=False)
    settings.set("save_to_sent", "never")
    smtp = FakeSMTP()
    monkeypatch.setattr(providers, "connect_smtp", lambda cfg: smtp)
    monkeypatch.setattr(sender.time, "sleep", lambda s: None)
    monkeypatch.setattr(precleared.time, "sleep", lambda s: None)
    db = DB(path=str(tmp_path / "ol.db"))
    db.upsert_lead({"email": "ada@globex.co.uk", "first_name": "Ada", "last_name": "Lovelace",
                    "organization": "Globex", "country": "United Kingdom",
                    "signals": {"groundtruth_exact": True}})
    yield {"db": db, "smtp": smtp}
    db.close()


@pytest.fixture
def api(monkeypatch):
    """Script Precleared's answers; records every call as (url, payload, api_key)."""
    calls = []
    answers = []

    def fake_post(url, payload, api_key=""):
        calls.append((url, payload, api_key))
        return answers.pop(0) if answers else OK
    monkeypatch.setattr(precleared, "_post", fake_post)
    return {"calls": calls, "answers": answers}


def _send(env, *drafts, **kw):
    drafts = drafts or (Draft(email="ada@globex.co.uk", subject="hi", body="Hello Ada,"),)
    return sender.send_drafts(list(drafts), dry_run=False, db=env["db"], **kw)


def _timeline(env, email="ada@globex.co.uk"):
    from openleads.workspace import activity
    return [a for a in activity.timeline(env["db"], "contact", email) if a["kind"] == "precleared"]


# --- the contract: one check before the first email -------------------------
def test_ok_to_email_sends_and_tells_precleared_what_it_knows(env, api):
    res = _send(env)
    assert res[0].status == "sent" and env["smtp"].sent == ["ada@globex.co.uk"]
    assert len(api["calls"]) == 1
    url, payload, key = api["calls"][0]
    assert url == "https://precleared.dev/api/v1/check?src=openleads" and key == ""
    assert payload == {
        "recipient_email": "ada@globex.co.uk", "sender_country": "GB",
        "address_source": "scraped", "existing_customer": False,
        "pitch": "We build billing software for clinics.", "company_name": "Globex",
        "recipient_name": "Ada Lovelace", "recipient_country": "GB",
    }
    assert _timeline(env) == []                      # nothing to show for a clear address


def test_consent_needed_is_held_with_reason_and_receipt(env, api):
    api["answers"].append(CONSENT)
    res = _send(env)
    assert res[0].status == "skipped" and env["smtp"].sent == []
    assert res[0].detail == ("precleared: consent_needed. UK sole traders need consent before a "
                             "marketing email. (PECR reg 22) Next step: Ask for permission first. "
                             "Receipt rcpt_consent.")
    # recorded against the contact, where the dashboard and `people show` look
    (row,) = _timeline(env)
    assert row["label"] == "Cold-email check" and row["summary"].startswith("held: precleared")
    assert row["data"]["verdict"] == "consent_needed"
    assert row["data"]["receipt_id"] == "rcpt_consent"
    assert row["data"]["next_step"] == "Ask for permission first."
    # the attempt is in the send log too, as every skip is
    assert env["db"].touches_for("ada@globex.co.uk")[0]["status"] == "skipped"
    # and the verdict is kept, so the next attempt costs no check
    _send(env)
    assert len(api["calls"]) == 1
    assert env["db"].kv_get("precleared:ada@globex.co.uk")["receipt_id"] == "rcpt_consent"


def test_unknown_is_held_and_never_cached(env, api):
    api["answers"].append(UNKNOWN)
    res = _send(env)
    assert res[0].status == "skipped" and res[0].detail.startswith("precleared: unknown.")
    assert "Could not tell who owns the domain." in res[0].detail
    assert env["db"].kv_get("precleared:ada@globex.co.uk") is None
    api["answers"].append(UNKNOWN)
    _send(env)
    assert len(api["calls"]) == 2                    # asked again


def test_check_that_cannot_run_holds_in_hold_mode(env, api):
    api["answers"].append(DOWN)
    res = _send(env)
    assert res[0].status == "skipped"
    assert res[0].detail == "precleared: not checked. Precleared could not be reached (connection refused)"
    assert env["smtp"].sent == []
    assert _timeline(env)[0]["data"]["error"].startswith("Precleared could not be reached")


def test_check_that_cannot_run_sends_in_warn_mode(env, api, monkeypatch):
    monkeypatch.setenv("PRECLEARED_MODE", "warn")
    api["answers"].append(DOWN)
    res = _send(env)
    assert res[0].status == "sent" and env["smtp"].sent == ["ada@globex.co.uk"]
    (row,) = _timeline(env)
    assert row["summary"].startswith("sent anyway (warn mode): precleared: not checked.")
    assert row["data"]["held"] is False


def test_warn_mode_records_a_verdict_and_sends_anyway(env, api, monkeypatch):
    monkeypatch.setenv("PRECLEARED_MODE", "warn")
    api["answers"].append(CONSENT)
    res = _send(env)
    assert res[0].status == "sent"
    assert _timeline(env)[0]["data"]["verdict"] == "consent_needed"


def test_off_mode_makes_no_call(env, api, monkeypatch):
    monkeypatch.setenv("PRECLEARED_MODE", "off")
    res = _send(env)
    assert res[0].status == "sent" and api["calls"] == []


def test_follow_ups_and_dry_runs_are_not_checked(env, api):
    env["db"].record_touch("ada@globex.co.uk", "sent", subject="hi", campaign="default", step=1)
    assert _send(env, step=2)[0].status == "sent"
    assert sender.send_drafts([Draft(email="ada@globex.co.uk", subject="s", body="b")],
                              dry_run=True, db=env["db"])[0].status == "preview"
    assert api["calls"] == []


def test_the_first_email_of_a_campaign_is_checked_whatever_its_step(env, api):
    """A sequence that opens with a call or LinkedIn task sends its first email at step 2."""
    env["db"].record_touch("ada@globex.co.uk", "sent", subject="hi", campaign="seq:9", step=1)
    api["answers"].append(CONSENT)
    res = _send(env, step=2, campaign="seq:10")
    assert res[0].status == "skipped" and len(api["calls"]) == 1


def test_a_cached_verdict_is_reused_for_thirty_days(env, api):
    """The same address in another campaign is a new first email, but not a new check."""
    _send(env, campaign="a")
    _send(env, campaign="b")
    assert len(api["calls"]) == 1
    row = env["db"].kv_get("precleared:ada@globex.co.uk")
    row["checked"] = time.time() - 31 * 86400
    env["db"].kv_set("precleared:ada@globex.co.uk", row)
    _send(env, campaign="c")
    assert len(api["calls"]) == 2                    # expired: asked again
    env["db"].upsert_lead({"email": "ada@globex.co.uk", "organization": "Globex Ltd"})
    _send(env, campaign="d")
    assert len(api["calls"]) == 3                    # different facts: asked again


# --- when Precleared itself is the problem -------------------------------------
def test_keyless_daily_limit_gets_a_free_key_with_the_sender_address(env, api):
    api["answers"].extend([
        (429, {"error": "daily_limit", "operator_message": "Free checks used up for today.",
               "create_key": {"method": "POST", "url": "https://precleared.dev/api/v1/keys",
                              "body": {"email": ""}}}),
        (201, {"api_key": "pc_live_abc123"}),
        OK,
    ])
    res = _send(env)
    assert res[0].status == "sent"
    assert [c[0] for c in api["calls"]] == ["https://precleared.dev/api/v1/check?src=openleads",
                                           "https://precleared.dev/api/v1/keys",
                                           "https://precleared.dev/api/v1/check?src=openleads"]
    assert api["calls"][1][1] == {"email": "me@acme.io"}
    assert api["calls"][2][2] == "pc_live_abc123"    # retried with the new key
    assert settings.get("precleared_api_key") == "pc_live_abc123"
    assert settings.source_of("precleared_api_key") == "store"


def test_keyless_daily_limit_without_a_sender_address_holds(env, api, monkeypatch):
    monkeypatch.setenv("SMTP_USER", "mailbox-login")
    api["answers"].append((429, {"error": "daily_limit", "operator_message": "Free checks used "
                                 "up for today; get a free key at https://precleared.dev/get-key",
                                 "create_key": {"method": "POST",
                                                "url": "https://precleared.dev/api/v1/keys"}}))
    res = _send(env)
    assert res[0].status == "skipped"
    assert res[0].detail == ("precleared: not checked. Free checks used up for today; get a free "
                             "key at https://precleared.dev/get-key")
    assert len(api["calls"]) == 1 and not settings.get("precleared_api_key")


def test_rate_limit_waits_and_retries_once(env, api, monkeypatch):
    waited = []
    monkeypatch.setattr(precleared.time, "sleep", waited.append)
    api["answers"].extend([(429, {"error": "rate_limited", "retry_after": 2}), OK])
    assert _send(env)[0].status == "sent"
    assert waited == [2.0] and len(api["calls"]) == 2
    api["answers"].extend([(429, {"error": "rate_limited"}), (429, {"error": "rate_limited"})])
    env["db"].kv_set("precleared:ada@globex.co.uk", None)
    res = _send(env, campaign="another")
    assert res[0].status == "skipped" and len(api["calls"]) == 4
    assert res[0].detail == ("precleared: not checked. Precleared is limiting how fast we can "
                             "check; it will be tried again next run")


def test_payment_required_and_bad_key_hold_with_the_message(env, api, monkeypatch):
    monkeypatch.setenv("PRECLEARED_API_KEY", "pc_live_old")
    api["answers"].append((402, {"error": "payment_required",
                                 "operator_message": "This key has no checks left.",
                                 "buy_url": "https://precleared.dev/buy?k=1"}))
    res = _send(env)
    assert res[0].detail == ("precleared: not checked. This key has no checks left. "
                             "https://precleared.dev/buy?k=1")
    assert api["calls"][0][2] == "pc_live_old"
    api["answers"].append((401, {"error": "invalid_key"}))
    res = _send(env)
    assert "rejected PRECLEARED_API_KEY" in res[0].detail
    assert "https://precleared.dev/get-key" in res[0].detail


def test_one_failed_call_holds_the_rest_of_the_batch_without_more_calls(env, api):
    env["db"].upsert_lead({"email": "bob@initech.com", "first_name": "Bob"})
    env["db"].kv_set("precleared:bob@initech.com", {
        "verdict": "ok_to_email", "reason": "", "next_step": "", "receipt_id": "rcpt_bob",
        "checked": time.time(),
        "inputs": precleared._fingerprint(precleared.payload_for(
            "bob@initech.com", env["db"].get_lead("bob@initech.com")))})
    api["answers"].append((503, {}))
    res = _send(env, Draft(email="ada@globex.co.uk", subject="s", body="b"),
                Draft(email="carol@hooli.com", subject="s", body="b"),
                Draft(email="bob@initech.com", subject="s", body="b"))
    assert [r.status for r in res] == ["skipped", "skipped", "sent"]
    assert res[0].detail == res[1].detail == ("precleared: not checked. Precleared is unavailable "
                                              "(HTTP 503); it will be tried again next run")
    assert len(api["calls"]) == 1                    # carol wasn't tried; bob was stored


def test_bad_request_is_about_this_address_only(env, api):
    api["answers"].append((400, {"error": "invalid_email", "message": "not an address"}))
    res = _send(env, Draft(email="ada@globex.co.uk", subject="s", body="b"),
                Draft(email="carol@hooli.com", subject="s", body="b"))
    assert res[0].detail == "precleared: not checked. Precleared rejected the request: not an address"
    assert res[1].status == "sent" and len(api["calls"]) == 2


# --- what we tell Precleared ------------------------------------------------------
def test_address_source_and_country_are_never_guessed():
    assert precleared.address_source({"signals": {"groundtruth_exact": True}}) == "scraped"
    assert precleared.address_source({"data": json.dumps({"signals": {"observed_pattern": True}})}) \
        == "unknown"
    assert precleared.address_source({}) == "unknown"
    assert precleared.country_code("United States") == "US"
    assert precleared.country_code("uk") == "GB"
    assert precleared.country_code("de") == "DE"
    assert precleared.country_code("Bavaria") == ""
    assert precleared.country_code(None) == ""


def test_payload_leaves_out_what_it_does_not_know(env, monkeypatch):
    monkeypatch.delenv("CAMPAIGN_CONTEXT")
    monkeypatch.setenv("PRECLEARED_SENDER_COUNTRY", "us")
    body = precleared.payload_for("x@y.com", {"email": "x@y.com", "stage": "customer"})
    assert body == {"recipient_email": "x@y.com", "sender_country": "US",
                    "address_source": "unknown", "existing_customer": True}


def test_settings_have_safe_defaults(env):
    assert settings.get("precleared_mode") == "hold"
    assert settings.get("precleared_sender_country") == "GB"
    assert settings.get("precleared_api_key") == ""
    with pytest.raises(ValueError):
        settings.set("precleared_mode", "maybe")
    assert precleared.current_mode() == "hold"


# --- sequences: a held contact is visible and doesn't count as a send error -----
def test_sequence_pauses_a_held_contact_with_the_reason(env, api):
    from openleads.workspace import sequences as S
    step = {"type": "auto_email", "subject": "hi {{first_name}}", "body": "Hello {{first_name}}"}
    s = S.create(env["db"], "Q4", [step, dict(step, delay_days=0)],
                 settings={"skip_weekends": False, "allow_risky": True}, status="active")
    env["db"].upsert_lead({"email": "carol@hooli.com", "first_name": "Carol", "tier": "safe"})
    S.enroll(env["db"], s["id"], ["ada@globex.co.uk", "carol@hooli.com"])
    api["answers"].extend([CONSENT, DOWN])
    out = S.process(env["db"], dry_run=False)
    assert out["held"] == 2 and out["errors"] == 0 and out["sent"] == 0
    by_email = {e["email"]: e for e in S.enrollments(env["db"], s["id"])}
    assert by_email["ada@globex.co.uk"]["status"] == "paused"
    assert by_email["ada@globex.co.uk"]["last_error"].startswith("precleared: consent_needed.")
    assert by_email["carol@hooli.com"]["status"] == "active"       # still due next run
    assert by_email["carol@hooli.com"]["errors"] == 0


def test_held_verdict_parses_only_hold_lines():
    assert precleared.held_verdict("precleared: blocked. No.") == "blocked"
    assert precleared.held_verdict("precleared: not checked. Down.") == ""
    assert precleared.held_verdict("suppressed: bounced") == ""
    assert precleared.held_verdict("") == ""


# --- the HTTP call itself, against a local server ---------------------------------
@pytest.fixture
def server():
    seen = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            raw = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            seen.append((self.path, dict(self.headers), json.loads(raw)))
            if self.path.startswith("/limited"):
                self.send_response(429)
                self.send_header("Retry-After", "7")
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"error": "rate_limited"}')
                return
            if self.path.startswith("/broken"):
                self.send_response(500)
                self.end_headers()
                self.wfile.write(b"<html>oops</html>")
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"verdict": "ok_to_email", "receipt": {"id": "r1"}}).encode())

        def log_message(self, *a):
            pass

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}", seen
    httpd.shutdown()


def test_post_sends_json_with_the_tool_identified(server):
    base, seen = server
    status, body = precleared._post(base + "/check?src=openleads", {"recipient_email": "a@b.c"},
                                    api_key="pc_live_k")
    assert status == 200 and body["verdict"] == "ok_to_email" and body["receipt"]["id"] == "r1"
    path, headers, payload = seen[0]
    assert path == "/check?src=openleads" and payload == {"recipient_email": "a@b.c"}
    assert headers["User-Agent"] == "openleads (+https://github.com/Samyrrrrrr990/openleads)"
    assert headers["Content-Type"] == "application/json"
    assert headers["Authorization"] == "Bearer pc_live_k"


def test_post_reads_error_bodies_and_retry_after(server):
    base, _ = server
    status, body = precleared._post(base + "/limited", {})
    assert status == 429 and body == {"error": "rate_limited", "retry_after": "7"}
    assert precleared._retry_after(body) == 7.0
    status, body = precleared._post(base + "/broken", {})
    assert status == 500 and body == {}


def test_post_never_raises_without_a_server():
    status, body = precleared._post("http://127.0.0.1:9/check", {})
    assert status == 0 and body["error"]


def test_https_connects_fast_and_reads_patiently(monkeypatch):
    """Connect within 10s, then allow 30s per read (urllib has one timeout for both)."""
    import http.client

    seen = {"read_timeouts": []}

    class Sock:
        def settimeout(self, t):
            seen["read_timeouts"].append(t)

    def fake_connect(self):
        seen["connect_timeout"] = self.timeout
        self.sock = Sock()
    monkeypatch.setattr(http.client.HTTPSConnection, "connect", fake_connect)
    conn = precleared._Connection("precleared.dev", timeout=precleared.READ_TIMEOUT)
    conn.connect()
    assert seen["connect_timeout"] == 10 and seen["read_timeouts"] == [30]
    assert any(isinstance(h, precleared._Handler) for h in precleared._opener.handlers)
