"""Seniority and department inference from job titles."""
import pytest

from openleads.insights.titles import (
    SENIORITIES,
    classify,
    department,
    seniority,
    seniority_at_least,
)


@pytest.mark.parametrize("title,expected", [
    ("Co-Founder & CTO", "founder"),
    ("Founder", "founder"),
    ("Owner", "owner"),
    ("Practice Owner", "owner"),
    ("Product Owner", "entry"),
    ("CEO", "c_suite"),
    ("Chief Marketing Officer", "c_suite"),
    ("President", "c_suite"),
    ("Managing Director", "c_suite"),
    ("VP of Sales", "vp"),
    ("Senior Vice President, Engineering", "vp"),
    ("Managing Partner", "partner"),
    ("Partner Manager", "manager"),
    ("Head of Growth", "head"),
    ("Director of Engineering", "director"),
    ("Engineering Manager", "manager"),
    ("Team Lead, Support", "manager"),
    ("Senior Software Engineer", "senior"),
    ("Staff Engineer", "senior"),
    ("Dentist", "senior"),
    ("Software Engineer", "entry"),
    ("Marketing Intern", "intern"),
    ("Internal Medicine", "entry"),
    ("Clio admin, President", "c_suite"),
    ("", ""),
    ("Team member", ""),
    ("Team / contact address", ""),
])
def test_seniority(title, expected):
    assert seniority(title) == expected


@pytest.mark.parametrize("title,expected", [
    ("CTO", "engineering"),
    ("Chief Executive Officer", "executive"),
    ("Chief People Officer", "hr"),
    ("Chief Revenue Officer", "sales"),
    ("CFO", "finance"),
    ("Founder & CEO", "executive"),
    ("Owner", "executive"),
    ("VP of Marketing", "marketing"),
    ("Head of Growth", "marketing"),
    ("Account Executive", "sales"),
    ("Sales Engineer", "sales"),
    ("Customer Success Manager", "customer_success"),
    ("Product Manager", "product"),
    ("Product Designer", "design"),
    ("Product Marketing Manager", "marketing"),
    ("Data Scientist", "data"),
    ("Senior Software Engineer", "engineering"),
    ("Site Reliability Engineer", "engineering"),
    ("General Counsel", "legal"),
    ("Talent Acquisition Partner", "hr"),
    ("Pediatric Dentist", "medical"),
    ("Professor of Economics", "research"),
    ("Office Manager", "operations"),
    ("Financial Analyst", "finance"),
    ("Consultant", "consulting"),
    ("Editor", "media"),
    ("IT Manager", "it"),
    ("", ""),
    ("Team member", ""),
])
def test_department(title, expected):
    assert department(title) == expected


def test_classify_pairs():
    assert classify("VP of Marketing") == ("vp", "marketing")
    assert classify("Team member") == ("", "")


def test_seniority_ordering():
    keys = [k for k, _ in SENIORITIES]
    assert keys[0] == "owner" and keys[-1] == "intern"
    assert seniority_at_least("vp", "director")
    assert not seniority_at_least("manager", "director")
    assert not seniority_at_least("", "director")
