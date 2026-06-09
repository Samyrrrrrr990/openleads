"""Tests for the source registry and the YC source's pure parsing helpers."""
import html as ihtml
import json

from openleads.models import Query
from openleads.sources import get_registry, get_source, list_sources
from openleads.sources.yc import (
    filter_companies,
    parse_founders,
    pick_exec,
    split_location,
)


# --- registry --------------------------------------------------------------
def test_registry_includes_builtins():
    reg = get_registry(reload=True)
    for name in ("yc", "github", "npi", "openalex", "producthunt"):
        assert name in reg, f"missing built-in source: {name}"


def test_get_source_and_info():
    src = get_source("yc")
    assert src is not None
    info = src.info()
    assert info.name == "yc"
    assert info.kind == "company"
    assert info.description


def test_list_sources_sorted():
    infos = list_sources()
    names = [i.name for i in infos]
    assert names == sorted(names)


# --- yc parsing ------------------------------------------------------------
def _yc_page(founders):
    payload = {"props": {"company": {"founders": founders}}}
    encoded = ihtml.escape(json.dumps(payload), quote=True)
    return f'<div data-page="{encoded}" >content</div>'


def test_parse_founders_extracts_people():
    page = _yc_page([
        {"full_name": "Ada Lovelace", "title": "Founder", "linkedin_url": "https://li/ada"},
        {"full_name": "", "title": "ignored"},
    ])
    people = parse_founders(page)
    assert len(people) == 1
    assert people[0]["full_name"] == "Ada Lovelace"
    assert people[0]["linkedin_url"] == "https://li/ada"


def test_parse_founders_no_match():
    assert parse_founders("<html>no data-page here</html>") == []


def test_pick_exec_prefers_senior():
    founders = [
        {"full_name": "A B", "title": "Engineer"},
        {"full_name": "C D", "title": "Founder/CEO"},
    ]
    assert pick_exec(founders)["full_name"] == "C D"


def test_pick_exec_falls_back():
    assert pick_exec([{"full_name": "A B", "title": "Designer"}])["full_name"] == "A B"
    assert pick_exec([]) is None


def test_split_location():
    assert split_location("San Francisco, CA, USA") == ("San Francisco", "USA")
    assert split_location("Berlin") == ("Berlin", "")
    assert split_location("") == ("", "")


def test_filter_companies_industry_and_website():
    companies = [
        {"name": "A", "website": "https://a.com", "status": "Active",
         "team_size": 10, "industry": "Fintech"},
        {"name": "B", "website": "", "status": "Active", "team_size": 5},  # no website
        {"name": "C", "website": "https://c.com", "status": "Active",
         "team_size": 8, "industry": "Healthcare"},
    ]
    out = filter_companies(companies, Query(industry="fintech"))
    assert {c["name"] for c in out} == {"A"}
