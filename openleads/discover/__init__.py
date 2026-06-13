"""
Discovery helpers shared across sources and the federation layer.

* :mod:`openleads.discover.geo`    — place name → bounding box (OpenStreetMap Nominatim).
* :mod:`openleads.discover.people` — company page → real people (name + title).

These are thin, cached, and keyless — the same philosophy as the rest of the
engine. The parsing entry points are pure (no network) so they unit-test offline.
"""
