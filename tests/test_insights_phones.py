"""Phone normalization and extraction."""
import pytest

from openleads.insights.phones import display, extract_phones, normalize, split_tag


@pytest.mark.parametrize("raw,expected", [
    ("+1 (512) 555-0100", "+15125550100"),
    ("1-512-555-0100", "+15125550100"),
    ("(512) 555-0100", "5125550100"),
    ("0044 20 7946 0958", "+442079460958"),
    ("+44 20 7946 0958 ext. 12", "+442079460958"),
    ("tel:%2B49%2030%20123456", "+4930123456"),
    ("12345", ""),
    ("0000000000", ""),
    ("", ""),
    (None, ""),
])
def test_normalize(raw, expected):
    assert normalize(raw) == expected


def test_display():
    assert display("+15125550100") == "+1 512-555-0100"
    assert display("5125550100") == "(512) 555-0100"
    assert display("+442079460958") == "+44 207 946 0958"
    assert display("") == ""


def test_split_osm_tag():
    assert split_tag("+1 512 555 0100; +1 512 555 0101") == ["+15125550100", "+15125550101"]
    assert split_tag("") == []


def test_extract_from_page():
    page = """
      <a href="tel:+15125550100">Call us</a>
      <script type="application/ld+json">{"telephone": "+1 512-555-0199"}</script>
      <p>Phone: (512) 555-0123</p>
      <p>Founded 2019. Order #20241015. Zip 78701.</p>
      <a href="tel:+15125550100">again</a>
    """
    assert extract_phones(page) == ["+15125550100", "+15125550199", "5125550123"]


def test_extract_ignores_scripts_and_dates():
    assert extract_phones("<script>var phone = '5125550100'</script><p>20241015</p>") == []
