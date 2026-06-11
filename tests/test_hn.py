"""HN 'Who is hiring' source — pure parser tests (network-free)."""
from openleads.sources.hn import (
    _company_name,
    _pick_domain,
    parse_hiring_post,
)


def test_company_name_strips_yc_and_junk():
    assert _company_name("Carma (YC W24) | Founding Engineer | NYC") == "Carma"
    assert _company_name("Felt Clinic ( ) | Nurse") == "Felt Clinic"
    assert _company_name("Karhuno Group / | Sales") == "Karhuno Group"


def test_pick_domain_prefers_real_over_ats():
    # an ATS link is ignored in favor of the real company domain
    assert _pick_domain(["https://jobs.lever.co/acme/123", "https://acme.com"], "") == "acme.com"
    # only an ATS link + a real email → use the email's domain
    assert _pick_domain(["https://job-boards.greenhouse.io/acme/1"], "jobs@acme.io") == "acme.io"
    # only an ATS link, no email → no domain
    assert _pick_domain(["https://jobs.lever.co/acme/1"], "") == ""


def test_parse_post_with_groundtruth_email():
    html = ('<p>Carma (YC W24) | Founding Engineer | NYC | REMOTE</p>'
            '<p>Email <a href="mailto:sam&#x40;joincarma.com">sam@joincarma.com</a> '
            'or <a href="https:&#x2f;&#x2f;www.joincarma.com&#x2f;">site</a></p>')
    ent = parse_hiring_post(html)
    assert ent is not None
    assert ent.organization == "Carma"
    assert ent.domain == "joincarma.com"
    assert ent.extra["public_email"] == "sam@joincarma.com"   # ground truth → 'safe'
    assert ent.location == "REMOTE"
    assert "engineer" in ent.title.lower()
    assert ent.source == "hn"


def test_parse_post_domain_only_no_email():
    html = '<p>Eagle | Backend Engineer | SF</p><p>See <a href="https://eagleeng.com">us</a></p>'
    ent = parse_hiring_post(html)
    assert ent is not None
    assert ent.domain == "eagleeng.com"
    assert ent.extra["public_email"] == ""   # no email present → guessable, not ground truth


def test_parse_post_skipped_when_no_domain():
    # ATS-only link, no email, no company site → nothing actionable
    assert parse_hiring_post("<p>Acme | Engineer</p><p>Apply: "
                             '<a href="https://jobs.lever.co/acme/1">here</a></p>') is None
    assert parse_hiring_post("<p>just some reply text</p>") is None
