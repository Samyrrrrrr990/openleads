"""
MX lookups via DNS-over-HTTPS, cross-checked across multiple resolvers.

Using two independent resolvers (Google + Cloudflare) lets us (a) survive one
provider being down and (b) award extra confidence when they *agree* on the
mail exchangers for a domain.
"""
from __future__ import annotations

import json
import urllib.request

from openleads.config import USER_AGENT

# Each resolver formats its DoH JSON endpoint slightly differently.
RESOLVERS = {
    "google": "https://dns.google/resolve?name={name}&type=MX",
    "cloudflare": "https://cloudflare-dns.com/dns-query?name={name}&type=MX",
}


def _query(url: str, timeout: int = 15) -> dict:
    req = urllib.request.Request(
        url, headers={"User-Agent": USER_AGENT, "Accept": "application/dns-json"}
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def parse_mx(doh_json: dict) -> list[str]:
    """Extract MX hosts (priority-sorted, trailing dot stripped) from DoH JSON.

    Pure/network-free so it can be unit-tested with fixtures.
    """
    answers = (doh_json or {}).get("Answer") or []
    mxs: list[tuple[int, str]] = []
    for a in answers:
        if a.get("type") != 15:  # 15 == MX
            continue
        parts = str(a.get("data", "")).split()
        if len(parts) == 2:
            pri, host = parts
            try:
                mxs.append((int(pri), host.rstrip(".").lower()))
            except ValueError:
                continue
    mxs.sort()
    return [h for _, h in mxs]


def lookup(domain: str, timeout: int = 15) -> dict:
    """Resolve MX for ``domain`` across all resolvers.

    Returns ``{"hosts": [...], "resolvers_ok": int, "agreement": bool}``.

    * ``hosts`` is the merged, priority-stable host list.
    * ``resolvers_ok`` counts resolvers that returned at least one MX.
    * ``agreement`` is True when ≥2 resolvers returned the *same* top host set.
    """
    per_resolver: dict[str, list[str]] = {}
    for name, tmpl in RESOLVERS.items():
        try:
            per_resolver[name] = parse_mx(_query(tmpl.format(name=domain), timeout))
        except Exception:
            per_resolver[name] = []

    ok = {n: h for n, h in per_resolver.items() if h}
    # Merge preserving the first resolver's priority order, then append novel hosts.
    merged: list[str] = []
    for hosts in per_resolver.values():
        for h in hosts:
            if h not in merged:
                merged.append(h)

    agreement = False
    host_sets = [frozenset(h) for h in ok.values()]
    if len(host_sets) >= 2:
        agreement = any(
            host_sets[i] == host_sets[j]
            for i in range(len(host_sets))
            for j in range(i + 1, len(host_sets))
        )

    return {"hosts": merged, "resolvers_ok": len(ok), "agreement": agreement}
