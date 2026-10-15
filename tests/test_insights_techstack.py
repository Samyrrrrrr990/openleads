"""Technology detection from homepage HTML."""
from openleads.insights.techstack import CATEGORIES, NAMES, by_category, detect, names

SHOPIFY_PAGE = """<html><head>
<link href="https://cdn.shopify.com/s/files/1/theme.css" rel="stylesheet">
<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123"></script>
<script src="https://static.klaviyo.com/onsite/js/klaviyo.js"></script>
<script>!function(f,b,e,v,n,t,s){fbq('init', '123');}</script>
<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet">
</head><body><p>We love WordPress tutorials and HubSpot blog posts.</p></body></html>"""

DENTIST_PAGE = """<html><head><meta name="generator" content="WordPress 6.4">
<link rel='stylesheet' href='/wp-content/themes/dental/style.css'>
<script src="https://offsiteschedule.zocdoc.com/plugin/embed"></script>
<script src="https://connect.podium.com/widget.js"></script>
</head><body><a href="tel:5125550100">Call</a></body></html>"""


def test_detects_shopify_stack_without_false_positives_from_prose():
    found = names(SHOPIFY_PAGE)
    for tech in ("Shopify", "Google Analytics", "Klaviyo", "Meta Pixel", "Google Fonts"):
        assert tech in found
    # Mentioned in prose only: must not count.
    assert "WordPress" not in found and "HubSpot" not in found


def test_detects_local_business_tools():
    found = names(DENTIST_PAGE)
    assert {"WordPress", "Zocdoc", "Podium"} <= set(found)


def test_detect_shape_and_grouping():
    techs = detect(DENTIST_PAGE)
    assert all(set(t) == {"name", "category"} for t in techs)
    grouped = by_category(techs)
    assert grouped["CMS"] == ["WordPress"]
    assert "Scheduling" in grouped


def test_empty_and_catalog():
    assert detect("") == [] and detect(None) == []
    assert len(NAMES) == len(set(NAMES)) >= 90
    assert "Scheduling" in CATEGORIES
