"""
MX lookups via DNS-over-HTTPS, cross-checked across multiple resolvers.

Using two independent resolvers (Google + Cloudflare) lets us (a) survive one
provider being down and (b) award extra confidence when they *agree* on the
mail exchangers for a domain.

A failed lookup is reported as ``status: "error"`` — never as "no MX" — so a DNS
hiccup can't mark every address at a domain undeliverable (and cache that for a
week).
"""
from __future__ import annotations

import json

from openleads import _http
from openleads.config import api_headers

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
    """One DoH JSON query through the shared HTTP seam (retries + run deadline)."""
    return json.loads(_http.request(url, headers=api_headers(Accept="application/dns-json"),
                                    timeout=timeout))


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


def _answer(doh_json) -> tuple:
    """``(status, hosts)`` for one resolver's DoH JSON reply (pure).

    DNS ``Status`` 0 is NOERROR (MX hosts, or ``nomx`` when there are none), 3 is
    NXDOMAIN (the domain does not exist). Anything else — SERVFAIL, REFUSED, a
    reply that isn't DoH JSON — means *we don't know*, which is not the same as
    "no mail server".
    """
    if not isinstance(doh_json, dict):
        return "error", []
    st = doh_json.get("Status", 0)
    if st == 3:
        return "nxdomain", []
    if st != 0:
        return "error", []
    hosts = parse_mx(doh_json)
    return ("ok" if hosts else "nomx"), hosts


def lookup(domain: str, timeout: int = 15) -> dict:
    """Resolve MX for ``domain`` across all resolvers.

    Returns ``{"hosts", "resolvers_ok", "agreement", "status", "errors"}``.

    * ``hosts`` is the merged, priority-stable host list.
    * ``resolvers_ok`` counts resolvers that returned at least one MX.
    * ``agreement`` is True when ≥2 resolvers returned the *same* top host set.
    * ``status`` is ``ok`` (MX found), ``nomx`` (the domain answers but publishes no
      MX), ``nxdomain`` (no such domain) or ``error`` (no resolver gave an answer —
      a network/DNS failure, which callers must not treat or cache as "no MX").
    * ``errors`` lists what went wrong per resolver (empty when all answered).
    """
    per_resolver: dict[str, list[str]] = {}
    statuses: dict[str, str] = {}
    errors: list[str] = []
    for name, tmpl in RESOLVERS.items():
        url = tmpl.format(name=domain)
        try:
            reply = _query(url, timeout)
        except Exception as e:  # noqa: BLE001 — any failure is "no answer"
            statuses[name], per_resolver[name] = "error", []
            errors.append(f"{name}: {_http._reason(e)}")
            _http._record(url, _http._reason(e), e)
            continue
        statuses[name], per_resolver[name] = _answer(reply)
        if statuses[name] == "error":
            st = reply.get("Status") if isinstance(reply, dict) else "?"
            errors.append(f"{name}: DNS status {st}")

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

    seen = set(statuses.values())
    if merged:
        status = "ok"
    elif "nxdomain" in seen:
        status = "nxdomain"
    elif "nomx" in seen:
        status = "nomx"
    else:
        status = "error"
    return {"hosts": merged, "resolvers_ok": len(ok), "agreement": agreement,
            "status": status, "errors": errors}


def is_unknown(info: dict | None) -> bool:
    """True when an MX lookup result means "couldn't check", not "no mail server"."""
    info = info or {}
    return info.get("status") == "error" and not info.get("hosts")


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
    failed = False

    def txt_records(name: str) -> list[str]:
        nonlocal failed
        try:
            reply = _query(TXT_RESOLVER.format(name=name), timeout)
        except Exception:  # noqa: BLE001 — a failed lookup is "unknown", not "absent"
            failed = True
            return []
        # NOERROR / NXDOMAIN are answers; SERVFAIL & co. mean we couldn't tell.
        if not isinstance(reply, dict) or reply.get("Status", 0) not in (0, 3):
            failed = True
            return []
        return parse_txt(reply)

    for txt in txt_records(domain):
        if txt.lower().startswith("v=spf1"):
            spf_present = True
    for txt in txt_records(f"_dmarc.{domain}"):
        low = txt.lower()
        if low.startswith("v=dmarc1"):
            dmarc_present = True
            for part in low.split(";"):
                part = part.strip()
                if part.startswith("p="):
                    dmarc_policy = part[2:].strip()

    result = {"spf_present": spf_present, "dmarc_present": dmarc_present,
              "dmarc_policy": dmarc_policy}
    # A lookup that failed is retried next time instead of pinning "no SPF/DMARC"
    # on the domain for a week.
    if cache is not None and not failed:
        cache.set("mx", f"dnshealth:{domain}", result)
    return result
