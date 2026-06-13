"""Tests for team-page people discovery (pure HTML parsing, no network)."""
from openleads.discover import people


def test_looks_like_person_name():
    assert people.looks_like_person_name("Jane Smith")
    assert people.looks_like_person_name("Ada B. Lovelace")
    assert not people.looks_like_person_name("Our Team")
    assert not people.looks_like_person_name("CONTACT US")
    assert not people.looks_like_person_name("Jane")          # one token
    assert not people.looks_like_person_name("acme labs inc")  # not capitalized name


def test_extract_people_from_jsonld():
    html = """
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Person",
     "name":"Maria Gonzalez","jobTitle":"Chief Executive Officer"}
    </script>
    """
    out = people.extract_people(html)
    assert {"name": "Maria Gonzalez", "title": "Chief Executive Officer"} in out


def test_extract_people_inline_dash():
    html = "<ul><li>Jane Smith — Founder & CEO</li><li>John Doe — CTO</li></ul>"
    out = people.extract_people(html)
    names = {p["name"] for p in out}
    assert "Jane Smith" in names and "John Doe" in names


def test_extract_people_adjacent_lines():
    html = """
    <div class="member"><h3>Priya Patel</h3><p>Head of Growth</p></div>
    <div class="member"><h3>Sam Lee</h3><p>VP of Engineering</p></div>
    """
    out = people.extract_people(html)
    names = {p["name"]: p["title"] for p in out}
    assert "Priya Patel" in names and "growth" in names["Priya Patel"].lower()
    assert "Sam Lee" in names


def test_extract_people_ignores_nav_and_nonpeople():
    html = "<nav>About Us</nav><h2>Our Team</h2><a>Contact Us</a><p>Read More</p>"
    assert people.extract_people(html) == []


def test_extract_people_dedupes():
    html = ("<p>Jane Smith — CEO</p>"
            "<div><h3>Jane Smith</h3><span>Chief Executive Officer</span></div>")
    out = people.extract_people(html)
    assert len([p for p in out if p["name"] == "Jane Smith"]) == 1
