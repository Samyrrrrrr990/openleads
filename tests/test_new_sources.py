"""Fixture-based tests for github / npi / openalex / producthunt parsers (no network)."""
from openleads.sources.github import parse_user
from openleads.sources.npi import parse_results
from openleads.sources.openalex import parse_authors
from openleads.sources.producthunt import parse_feed


# --- github ----------------------------------------------------------------
def test_github_parse_user_email_domain():
    ent = parse_user({
        "login": "ada", "name": "Ada Lovelace", "company": "@Acme",
        "blog": "https://ada.dev", "email": "ada@acme.io", "html_url": "https://github.com/ada",
        "bio": "hacker", "followers": 10, "public_repos": 5,
    })
    assert ent.full_name == "Ada Lovelace"
    assert ent.organization == "Acme"          # leading @ stripped
    assert ent.domain == "acme.io"             # from public email
    assert ent.links["github"] == "https://github.com/ada"


def test_github_parse_user_blog_domain_fallback():
    ent = parse_user({"login": "x", "name": "Grace H", "blog": "https://grace.io"})
    assert ent.domain == "grace.io"


def test_github_parse_user_requires_name():
    assert parse_user({"login": "noname"}) is None
    assert parse_user({}) is None


# --- npi --------------------------------------------------------------------
def test_npi_parse_results():
    data = {"results": [{
        "number": 1234567890,
        "basic": {"first_name": "JOHN", "last_name": "SMITH", "credential": "MD"},
        "taxonomies": [{"desc": "Pediatrics", "primary": True}],
        "addresses": [{"address_purpose": "LOCATION", "city": "Palo Alto",
                       "state": "CA", "country_name": "United States"}],
    }]}
    ents = parse_results(data)
    assert len(ents) == 1
    e = ents[0]
    assert e.full_name == "John Smith"
    assert e.title == "Pediatrics"
    assert e.domain == ""                       # honest: NPI has no email
    assert e.links["npi"] == "1234567890"
    assert e.extra["vertical"] == "healthcare providers"


def test_npi_state_name_mapping():
    # The full-name → USPS abbreviation map the NPI source filters by.
    from openleads.sources.npi import STATES
    assert STATES["california"] == "CA"
    assert STATES["new york"] == "NY"


# --- openalex ---------------------------------------------------------------
def test_openalex_parse_authors():
    data = {"results": [{
        "display_name": "Marie Curie", "orcid": "https://orcid.org/0000",
        "works_count": 42, "cited_by_count": 9000, "id": "https://openalex.org/A1",
        "last_known_institutions": [{
            "display_name": "Sorbonne", "country_code": "FR",
            "homepage_url": "https://www.sorbonne.fr", "id": "https://openalex.org/I1",
        }],
    }]}
    ents = parse_authors(data)
    assert len(ents) == 1
    e = ents[0]
    assert e.full_name == "Marie Curie"
    assert e.organization == "Sorbonne"
    assert e.domain == "sorbonne.fr"
    assert e.links["orcid"] == "https://orcid.org/0000"


def test_openalex_no_institution_domainless():
    data = {"results": [{"display_name": "Anon Author"}]}
    e = parse_authors(data)[0]
    assert e.domain == ""
    assert e.organization == ""


# --- producthunt ------------------------------------------------------------
def test_producthunt_parse_atom_feed():
    xml = """<?xml version="1.0"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title>Acme Widget</title>
        <link href="https://www.producthunt.com/posts/acme"/>
        <summary>Great tool at https://acme.io for teams</summary>
      </entry>
    </feed>"""
    ents = parse_feed(xml)
    assert len(ents) == 1
    e = ents[0]
    assert e.organization == "Acme Widget"
    assert e.domain == "acme.io"               # external URL pulled from summary
    assert e.links["producthunt"].endswith("/posts/acme")


def test_producthunt_ph_link_not_used_as_domain():
    xml = """<rss><channel><item>
      <title>NoSite Product</title>
      <link>https://www.producthunt.com/posts/nosite</link>
      <description>no external link here</description>
    </item></channel></rss>"""
    e = parse_feed(xml)[0]
    assert e.domain == ""                       # producthunt.com is not the product domain


def test_producthunt_bad_xml():
    assert parse_feed("not xml") == []
