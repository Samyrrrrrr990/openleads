"""Company profile parsing from a homepage."""
from openleads.cache.store import Cache
from openleads.insights import company

PAGE = """<!doctype html><html><head>
<title>Home | Acme Dental Austin</title>
<meta name="description" content="Family &amp; cosmetic dentistry in downtown Austin since 2009.">
<meta property="og:site_name" content="Acme Dental">
<meta name="keywords" content="dentist, austin, invisalign">
<link rel="stylesheet" href="/wp-content/themes/acme/style.css">
<script type="application/ld+json">{
  "@context": "https://schema.org", "@type": "Dentist", "name": "Acme Dental",
  "telephone": "+1 512-555-0100", "foundingDate": "2009-04-01",
  "numberOfEmployees": {"@type": "QuantitativeValue", "value": 14},
  "address": {"@type": "PostalAddress", "streetAddress": "100 Congress Ave",
              "addressLocality": "Austin", "addressRegion": "TX", "postalCode": "78701",
              "addressCountry": "US"}
}</script>
</head><body>
<a href="https://www.facebook.com/acmedental">Facebook</a>
<a href="https://www.linkedin.com/company/acme-dental/">LinkedIn</a>
<a href="tel:+15125550111">Call the office</a>
</body></html>"""


def test_parse_profile_full():
    p = company.parse_profile(PAGE, "AcmeDental.example")
    assert p["domain"] == "acmedental.example"
    assert p["name"] == "Acme Dental"
    assert p["description"].startswith("Family & cosmetic dentistry")
    assert p["industry"] == "Dental"
    assert p["phone"] == "+15125550100" and "+15125550111" in p["phones"]
    assert p["socials"]["linkedin"] == "https://www.linkedin.com/company/acme-dental"
    assert "WordPress" in p["technologies"]
    assert p["founded"] == "2009"
    assert p["employees"] == "14" and p["size"] == "11-50"
    assert p["address"] == {"street": "100 Congress Ave", "city": "Austin", "region": "TX",
                            "postal": "78701", "country": "US"}
    assert p["keywords"] == ["dentist", "austin", "invisalign"]


def test_title_fallback_skips_generic_words():
    p = company.parse_profile("<title>Welcome - Bright Smiles Studio</title>", "x.example")
    assert p["name"] == "Bright Smiles Studio"
    assert p["industry"] == "" and p["technologies"] == []


def test_fetch_profile_caches(monkeypatch, tmp_path):
    calls = []

    def fake_get_text(url, **kw):
        calls.append(url)
        return PAGE

    monkeypatch.setattr("openleads._http.get_text", fake_get_text)
    cache = Cache(tmp_path / "c.db")
    try:
        a = company.fetch_profile("acmedental.example", cache=cache)
        b = company.fetch_profile("acmedental.example", cache=cache)
    finally:
        cache.close()
    assert a["name"] == b["name"] == "Acme Dental"
    assert len(calls) == 1


def test_fetch_profile_unreachable(monkeypatch):
    monkeypatch.setattr("openleads._http.get_text", lambda url, **kw: None)
    p = company.fetch_profile("down.example")
    assert p["error"] == "homepage unreachable"
