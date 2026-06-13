"""Tests for chat session logic: slash commands, refinements, export (no network)."""
from openleads import chat
from openleads.models import Lead


def _lead(conf="verified", email="ada@acme.io", tier="safe"):
    return Lead(first_name="Ada", last_name="Lovelace", email=email,
                organization="Acme", confidence=conf, score=90, tier=tier, source="yc")


def test_handle_slash_quit_returns_false():
    sess = chat.Session()
    try:
        assert chat._handle_slash("/quit", sess, None) is False
    finally:
        sess.cache.close()


def test_handle_slash_count_and_source_and_format():
    sess = chat.Session()
    try:
        chat._handle_slash("/count 7", sess, None)
        assert sess.count == 7
        chat._handle_slash("/source npi", sess, None)
        assert sess.source == "npi"
        chat._handle_slash("/source nope", sess, None)
        assert sess.source == "npi"   # unchanged on bad source
        chat._handle_slash("/format ndjson", sess, None)
        assert sess.fmt == "ndjson"
        chat._handle_slash("/verified", sess, None)
        assert sess.verified_only is True
    finally:
        sess.cache.close()


def test_refine_only_verified_filters():
    sess = chat.Session()
    try:
        # v4: "only verified" keeps the deliverable 'safe' tier (not the legacy label).
        sess.last_leads = [_lead("verified", tier="safe"),
                           _lead("pattern_guess", "x@y.com", tier="risky")]
        handled = chat._maybe_refine("only verified", sess, None)
        assert handled is True
        assert len(sess.last_leads) == 1
        assert sess.last_leads[0].tier == "safe"
    finally:
        sess.cache.close()


def test_refine_export_writes_file(tmp_path):
    sess = chat.Session()
    try:
        sess.last_leads = [_lead()]
        out = tmp_path / "leads.ndjson"
        handled = chat._maybe_refine(f"export to {out}", sess, None)
        assert handled is True
        lines = [ln for ln in out.read_text().splitlines() if ln.strip()]
        assert len(lines) == 1
        assert "ada@acme.io" in lines[0]
    finally:
        sess.cache.close()


def test_refine_noop_without_results():
    sess = chat.Session()
    try:
        assert chat._maybe_refine("only verified", sess, None) is False
    finally:
        sess.cache.close()
