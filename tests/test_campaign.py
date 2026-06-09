"""Tests for the campaign tool's pure text helpers (no network/SMTP/LLM)."""
from openleads.campaign import (
    clean_dashes,
    format_body,
    has_placeholder,
    parse_response,
    strip_placeholders,
)


def test_clean_dashes_normalizes_unicode():
    assert clean_dashes("a—b") == "a,b"          # em dash → comma
    assert clean_dashes("it’s") == "it's"        # smart quote → ascii
    assert clean_dashes("a…b") == "a...b"        # ellipsis


def test_placeholder_detection_and_strip():
    assert has_placeholder("Hi [name]")
    assert has_placeholder("Hi {company}")
    assert not has_placeholder("Hi Ada")
    assert strip_placeholders("Hi [name] there") == "Hi there"


def test_format_body_adds_greeting():
    out = format_body("Loved your work. Let's talk.", "Ada")
    assert out.startswith("Hey Ada,\n\n")


def test_format_body_keeps_existing_greeting():
    out = format_body("Hey Ada,\nLine right after.", "Ada")
    assert out.splitlines()[0] == "Hey Ada,"
    assert out.splitlines()[1] == ""   # blank line inserted after greeting


def test_parse_response_structured():
    resp = "SUBJECT: hello there\n\nEMAIL:\nHey Ada,\n\nbody text"
    subject, body = parse_response(resp, "Acme")
    assert subject == "hello there"
    assert "body text" in body


def test_parse_response_fallback():
    subject, body = parse_response("just a blob of text", "Acme")
    assert "Acme" in subject
    assert body == "just a blob of text"
