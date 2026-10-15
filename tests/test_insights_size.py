"""Headcount bucketing."""
import pytest

from openleads.insights.companysize import bucket, bucket_range, parse_headcount


@pytest.mark.parametrize("value,expected", [
    (37, "11-50"), ("37", "11-50"), (1, "1-10"), ("8 people", "1-10"),
    ("51-200 employees", "51-200"), ("201-500", "201-500"), ("1,000+", "501-1000"),
    ("1,001-5,000", "1001-5000"), ("10k", "5001-10000"), ("12,000", "10001+"),
    ("about 120 people", "51-200"), ("11 to 50", "11-50"), ("10001+", "10001+"),
    ("", ""), (None, ""), ("n/a", ""), (0, ""), (True, ""),
])
def test_bucket(value, expected):
    assert bucket(value) == expected


def test_parse_headcount_midpoint():
    assert parse_headcount("51-200") == 125
    assert parse_headcount("2.5k") == 2500


def test_bucket_range():
    assert bucket_range("11-50") == (11, 50)
    assert bucket_range("10001+") == (10001, None)
    assert bucket_range("nope") == (None, None)
