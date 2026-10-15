"""Social profile extraction."""
import pytest

from openleads.insights.socials import classify_url, extract_socials


@pytest.mark.parametrize("url,network,canonical", [
    ("https://www.linkedin.com/company/acme-dental/", "linkedin",
     "https://www.linkedin.com/company/acme-dental"),
    ("https://uk.linkedin.com/company/acme/jobs", "linkedin", "https://www.linkedin.com/company/acme"),
    ("https://twitter.com/acmedental", "twitter", "https://x.com/acmedental"),
    ("https://x.com/acme_hq/", "twitter", "https://x.com/acme_hq"),
    ("https://www.facebook.com/AcmeDental", "facebook", "https://www.facebook.com/AcmeDental"),
    ("//instagram.com/acme", "instagram", "https://www.instagram.com/acme"),
    ("https://www.youtube.com/@acme", "youtube", "https://www.youtube.com/@acme"),
    ("https://github.com/acme", "github", "https://github.com/acme"),
    ("https://www.tiktok.com/@acme", "tiktok", "https://www.tiktok.com/@acme"),
    # share buttons and posts are not profiles
    ("https://www.facebook.com/sharer/sharer.php?u=x", "", ""),
    ("https://twitter.com/intent/tweet?text=hi", "", ""),
    ("https://www.linkedin.com/shareArticle?mini=true", "", ""),
    ("https://www.instagram.com/p/Cx1/", "", ""),
    ("https://example.com/twitter", "", ""),
    ("mailto:hi@acme.com", "", ""),
])
def test_classify(url, network, canonical):
    assert classify_url(url) == (network, canonical)


def test_extract_first_profile_per_network():
    page = """
      <a href="https://www.facebook.com/sharer/sharer.php?u=1">share</a>
      <a href="https://www.facebook.com/acme">fb</a>
      <a href="https://www.facebook.com/acme-other">fb2</a>
      <a href='https://www.linkedin.com/company/acme'>in</a>
      <a href="https://twitter.com/acme?ref=footer&amp;s=1">tw</a>
    """
    assert extract_socials(page) == {
        "facebook": "https://www.facebook.com/acme",
        "linkedin": "https://www.linkedin.com/company/acme",
        "twitter": "https://x.com/acme",
    }
