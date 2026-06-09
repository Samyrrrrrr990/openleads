"""Tests for the SQLite cache: get/set, TTL expiry, clear, info."""
import time

from openleads.cache.store import Cache


def test_set_get_roundtrip(tmp_path):
    c = Cache(path=tmp_path / "c.db")
    c.set("mx", "acme.com", {"hosts": ["mx1"], "agreement": True})
    assert c.get("mx", "acme.com") == {"hosts": ["mx1"], "agreement": True}
    assert c.get("mx", "missing.com") is None


def test_ttl_expiry(tmp_path):
    c = Cache(path=tmp_path / "c.db", ttls={"mx": 0})  # instant expiry
    c.set("mx", "acme.com", {"x": 1})
    time.sleep(0.01)
    assert c.get("mx", "acme.com") is None  # expired → evicted


def test_namespaces_isolated(tmp_path):
    c = Cache(path=tmp_path / "c.db")
    c.set("mx", "k", 1)
    c.set("verify", "k", 2)
    assert c.get("mx", "k") == 1
    assert c.get("verify", "k") == 2


def test_clear_and_info(tmp_path):
    c = Cache(path=tmp_path / "c.db")
    c.set("mx", "a", 1)
    c.set("dataset", "b", [1, 2])
    info = c.info()
    assert info["counts"]["mx"] == 1
    assert info["counts"]["dataset"] == 1
    removed = c.clear()
    assert removed == 2
    assert c.info()["counts"] == {}
