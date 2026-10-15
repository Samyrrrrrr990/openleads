"""
A company profile from its homepage: name, description, industry, phones, social
profiles, technologies, founding year, headcount and address.

:func:`parse_profile` is pure (HTML in, dict out). :func:`fetch_profile` does one
GET of the homepage, which the email waterfall has usually cached already, and
caches the parsed profile for two weeks, so enriching a company is close to free.
"""
from __future__ import annotations

import html as ihtml
import json
import re

from openleads.insights import companysize, phones, socials, techstack

# schema.org business types → a human industry label.
_SCHEMA_INDUSTRY = (
    (("dentist",), "Dental"),
    (("physician", "medicalclinic", "medicalbusiness", "medicalorganization", "hospital",
      "optician", "pharmacy"), "Medical practice"),
    (("veterinarycare",), "Veterinary"),
    (("legalservice", "attorney", "notary"), "Legal services"),
    (("accountingservice",), "Accounting"),
    (("insuranceagency",), "Insurance"),
    (("financialservice", "bankorcreditunion"), "Financial services"),
    (("realestateagent",), "Real estate"),
    (("restaurant", "cafeorcoffeeshop", "bakery", "barorpub", "foodestablishment",
      "winery", "brewery"), "Food & beverage"),
    (("healthclub", "exercisegym", "sportsactivitylocation"), "Fitness"),
    (("beautysalon", "hairsalon", "dayspa", "nailsalon", "healthandbeautybusiness"),
     "Beauty & wellness"),
    (("autorepair", "autodealer", "automotivebusiness", "autobodyshop"), "Automotive"),
    (("hotel", "motel", "lodgingbusiness", "bedandbreakfast"), "Hospitality"),
    (("plumber", "electrician", "hvacbusiness", "roofingcontractor", "generalcontractor",
      "homeandconstructionbusiness", "locksmith", "housepainter"), "Construction & trades"),
    (("educationalorganization", "school", "collegeoruniversity"), "Education"),
    (("employmentagency",), "Staffing & recruiting"),
    (("travelagency",), "Travel"),
    (("store", "clothingstore", "onlinestore"), "Retail"),
    (("professionalservice",), "Professional services"),
    (("softwareapplication", "webapplication"), "Software"),
    (("ngo", "nonprofit"), "Nonprofit"),
)

_ORG_HINTS = {"organization", "corporation", "localbusiness", "ngo", "onlinebusiness",
              "store", "professionalservice"}
_META_RE = re.compile(r"<meta\s+([^>]+?)/?>", re.I | re.S)
_ATTR_RE = re.compile(r"""([a-zA-Z:-]+)\s*=\s*["']([^"']*)["']""")
_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)
_LD_RE = re.compile(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
                    re.I | re.S)


def _metas(page: str) -> dict:
    out: dict = {}
    for m in _META_RE.finditer(page):
        attrs = {k.lower(): v for k, v in _ATTR_RE.findall(m.group(1))}
        key = (attrs.get("property") or attrs.get("name") or "").lower()
        if key and "content" in attrs and key not in out:
            out[key] = ihtml.unescape(attrs["content"]).strip()
    return out


def _jsonld_nodes(page: str) -> list:
    nodes: list = []

    def walk(node, depth=0):
        if depth > 6:
            return
        if isinstance(node, list):
            for n in node:
                walk(n, depth + 1)
        elif isinstance(node, dict):
            nodes.append(node)
            for v in node.values():
                if isinstance(v, (list, dict)):
                    walk(v, depth + 1)

    for m in _LD_RE.finditer(page):
        try:
            walk(json.loads(m.group(1).strip()))
        except ValueError:
            continue
    return nodes


def _types(node: dict) -> list:
    t = node.get("@type")
    return [str(x).lower() for x in (t if isinstance(t, list) else [t]) if x]


def _org_node(nodes: list) -> dict:
    """The JSON-LD node describing the business itself, if any."""
    best = {}
    for n in nodes:
        types = _types(n)
        if not types:
            continue
        is_business = any(t in _ORG_HINTS or industry_for_types([t]) for t in types)
        if is_business and n.get("name"):
            if not best or (n.get("address") and not best.get("address")):
                best = n
    return best


def industry_for_types(types: list) -> str:
    for t in types:
        low = str(t).lower()
        for keys, label in _SCHEMA_INDUSTRY:
            if low in keys:
                return label
    return ""


def _clean_title(title: str) -> str:
    t = re.sub(r"\s+", " ", ihtml.unescape(title or "")).strip()
    parts = [p.strip() for p in re.split(r"\s[|–—:\-]\s|\s·\s", t) if p.strip()]
    if not parts:
        return ""
    # "Home | Acme Dental" → prefer the part that isn't a generic page word.
    for p in parts:
        if p.lower() not in ("home", "homepage", "welcome", "index", "official site"):
            return p[:80]
    return parts[0][:80]


def _address(node: dict) -> dict:
    addr = node.get("address")
    if isinstance(addr, list):
        addr = addr[0] if addr else {}
    if isinstance(addr, str):
        return {"street": addr.strip()[:120]}
    if not isinstance(addr, dict):
        return {}
    country = addr.get("addressCountry")
    if isinstance(country, dict):
        country = country.get("name") or country.get("@id") or ""
    out = {
        "street": str(addr.get("streetAddress") or "").strip(),
        "city": str(addr.get("addressLocality") or "").strip(),
        "region": str(addr.get("addressRegion") or "").strip(),
        "postal": str(addr.get("postalCode") or "").strip(),
        "country": str(country or "").strip(),
    }
    return {k: v for k, v in out.items() if v}


def _employees(node: dict) -> str:
    n = node.get("numberOfEmployees")
    if isinstance(n, dict):
        if n.get("value"):
            return str(n["value"])
        lo, hi = n.get("minValue"), n.get("maxValue")
        if lo and hi:
            return f"{lo}-{hi}"
        return str(lo or hi or "")
    return str(n or "")


def parse_profile(html_text: str, domain: str = "") -> dict:
    """Everything a company's homepage says about it (pure / network-free)."""
    page = html_text or ""
    metas = _metas(page)
    nodes = _jsonld_nodes(page)
    org = _org_node(nodes)
    title_m = _TITLE_RE.search(page)

    name = (metas.get("og:site_name") or str(org.get("name") or "").strip()
            or _clean_title(title_m.group(1) if title_m else ""))
    description = (metas.get("description") or metas.get("og:description")
                   or str(org.get("description") or "")).strip()
    description = re.sub(r"\s+", " ", description)[:300]
    founded = str(org.get("foundingDate") or "").strip()
    m = re.search(r"\b(1[89]\d\d|20\d\d)\b", founded)
    employees = _employees(org)
    tech = techstack.detect(page)
    found_phones = phones.extract_phones(page)
    if org.get("telephone"):
        # The business's declared number is its main line: put it first.
        tel = phones.normalize(str(org["telephone"]))
        if tel:
            found_phones = [tel] + [p for p in found_phones if p != tel]
    keywords = [k.strip() for k in (metas.get("keywords") or "").split(",") if k.strip()][:10]
    profile = {
        "domain": (domain or "").lower(),
        "name": ihtml.unescape(name)[:120],
        "description": description,
        "industry": industry_for_types(_types(org)) if org else "",
        "phones": found_phones,
        "phone": found_phones[0] if found_phones else "",
        "socials": socials.extract_socials(page),
        "technologies": [t["name"] for t in tech],
        "tech": tech,
        "founded": m.group(1) if m else "",
        "employees": employees,
        "size": companysize.bucket(employees),
        "address": _address(org) if org else {},
        "keywords": keywords,
    }
    return profile


def fetch_profile(domain: str, cache=None, timeout: int = 8, refresh: bool = False) -> dict:
    """Fetch and parse ``domain``'s homepage. Cached (``profile`` namespace, 14 days)."""
    from openleads._http import get_text
    domain = (domain or "").lower().strip().strip("/")
    if not domain:
        return {"domain": "", "error": "no domain"}
    if cache is not None and not refresh:
        hit = cache.get("profile", domain)
        if hit is not None:
            return hit
    page = None
    # Same URL the email harvester fetches, so this is usually a cache hit.
    for url in (f"https://{domain}", f"https://www.{domain}"):
        page = get_text(url, timeout=timeout, cache=cache, ttl_ns="dataset")
        if page:
            break
    if not page:
        return {"domain": domain, "error": "homepage unreachable"}
    profile = parse_profile(page, domain)
    if cache is not None:
        cache.set("profile", domain, profile)
    return profile
