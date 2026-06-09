"""SQLite-backed cache so domains/mailservers/datasets aren't re-probed each run."""
from openleads.cache.store import Cache

__all__ = ["Cache"]
