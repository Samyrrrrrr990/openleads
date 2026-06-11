"""GitHub source v3.1 — quality filter tests (network-free)."""
from openleads.sources.github import _is_person_name, _usable_domain, parse_user


def test_person_name_filter():
    assert _is_person_name("Ada Lovelace")
    assert _is_person_name("Linus Torvalds")
    assert _is_person_name("Orhun Parmaksız")
    # non-people
    assert not _is_person_name("Machine Learning Mastery")
    assert not _is_person_name("Awesome Deep Learning")
    assert not _is_person_name("ML")            # too short / one token
    assert not _is_person_name("OPENAI")        # acronym org
    assert not _is_person_name("data-science-handbook")


def test_usable_domain_prefers_email_rejects_social():
    assert _usable_domain("ada@acme.io", "https://youtube.com/x") == "acme.io"
    assert _usable_domain("", "https://ada.dev") == "ada.dev"
    assert _usable_domain("", "https://medium.com/@ada") == ""   # blog platform → unusable
    assert _usable_domain("", "https://x.com/ada") == ""


def test_parse_user_real_person_with_email():
    ent = parse_user({"login": "ada", "type": "User", "name": "Ada Lovelace",
                      "email": "ada@acme.io", "blog": "https://acme.io",
                      "company": "@Acme", "location": "London"})
    assert ent is not None
    assert ent.full_name == "Ada Lovelace"
    assert ent.domain == "acme.io"
    assert ent.extra["public_email"] == "ada@acme.io"   # ground truth
    assert ent.organization == "Acme"


def test_parse_user_rejects_org_and_topic_accounts():
    assert parse_user({"login": "tf", "type": "Organization", "name": "TensorFlow"}) is None
    assert parse_user({"login": "ml", "type": "User", "name": "Machine Learning",
                       "email": "", "blog": "https://youtube.com/ml"}) is None
    # real-looking name but no reachable domain → skipped
    assert parse_user({"login": "x", "type": "User", "name": "John Smith",
                       "email": "", "blog": ""}) is None
