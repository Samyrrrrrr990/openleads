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
TXT_RESOLVER = "https://dns.google/resolve?name={name}&type=TXT"

# Substrings that identify the big mailbox providers from their MX hostnames.
# Provider matters: it tells us catch-all/verification behavior and that the
# domain is professionally hosted (a small positive signal).
PROVIDER_SIGNATURES = (
    ("google", ("google.com", "googlemail.com", "aspmx.l.google")),
    ("microsoft", ("outlook.com", "protection.outlook", "office365")),
    ("zoho", ("zoho.com", "zoho.eu")),
    ("proton", ("protonmail.ch", "proton.me")),
    ("yahoo", ("yahoodns.net",)),
    ("apple", ("icloud.com", "mail.me.com")),
)


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


def parse_txt(doh_json: dict) -> list[str]:
    """Extract TXT record strings from DoH JSON (pure/network-free)."""
    answers = (doh_json or {}).get("Answer") or []
    out = []
    for a in answers:
        if a.get("type") != 16:  # 16 == TXT
            continue
        data = str(a.get("data", "")).strip()
        # DoH wraps TXT values in quotes; long records arrive as "part1" "part2".
        data = "".join(p.strip('"') for p in data.split('" "'))
        out.append(data.strip('"'))
    return out


def classify_provider(hosts: list[str]) -> str:
    """Map MX hostnames to a provider name ('google', 'microsoft', …) or 'other'."""
    blob = " ".join(hosts or []).lower()
    for name, sigs in PROVIDER_SIGNATURES:
        if any(sig in blob for sig in sigs):
            return name
    return "other" if hosts else "none"


def dns_health(domain: str, cache=None, timeout: int = 15) -> dict:
    """Check SPF + DMARC presence for ``domain`` (free, no port 25 needed).

    Returns ``{"spf_present", "dmarc_present", "dmarc_policy"}``. A domain that
    publishes SPF and DMARC is a real, deliberately-configured mail domain — a
    small but real positive signal that an address there is legitimate.
    """
    if cache is not None:
        hit = cache.get("mx", f"dnshealth:{domain}")
        if hit is not None:
            return hit

    spf_present = dmarc_present = False
    dmarc_policy = ""
    try:
        for txt in parse_txt(_query(TXT_RESOLVER.format(name=domain), timeout)):
            if txt.lower().startswith("v=spf1"):
                spf_present = True
    except Exception:
        pass
    try:
        for txt in parse_txt(_query(TXT_RESOLVER.format(name=f"_dmarc.{domain}"), timeout)):
            low = txt.lower()
            if low.startswith("v=dmarc1"):
                dmarc_present = True
                for part in low.split(";"):
                    part = part.strip()
                    if part.startswith("p="):
                        dmarc_policy = part[2:].strip()
    except Exception:
        pass

    result = {"spf_present": spf_present, "dmarc_present": dmarc_present,
              "dmarc_policy": dmarc_policy}
    if cache is not None:
        cache.set("mx", f"dnshealth:{domain}", result)
    return result
