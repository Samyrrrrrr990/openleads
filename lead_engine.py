"""
OpenLeads - a free, open-source Apollo alternative for finding tech founders
and executives + their emails, using only free, keyless sources.

Pipeline:
  1. Company discovery   -> yc-oss public API (5,900+ YC startups, no key)
  2. People discovery     -> scrape each company's YC page founder JSON
  3. Email finding engine -> DNS-over-HTTPS MX lookup + name permutations
                             + live SMTP RCPT verification (port 25) w/ catch-all detection
  4. Output               -> leads.csv in the schema automation.py expects

No paid APIs. No API keys. Real verified emails where the mail server allows it,
smart pattern-guesses otherwise.

Usage:
    python3 lead_engine.py                 # build 20 leads, write leads.csv
    python3 lead_engine.py --count 30      # build 30
    python3 lead_engine.py --industry B2B  # only this YC industry
    python3 lead_engine.py --no-write      # dry run, print only
"""

import argparse
import csv
import html as ihtml
import json
import random
import re
import smtplib
import socket
import string
import sys
import time
import urllib.request

YC_ALL_COMPANIES = "https://yc-oss.github.io/api/companies/all.json"
YC_PAGE          = "https://www.ycombinator.com/companies/{slug}"
DOH_RESOLVE      = "https://dns.google/resolve?name={name}&type=MX"

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
# HELO/MAIL FROM identity used during verification probes (no mail is ever sent).
VERIFY_HELO = "ngnhacks.ca"
VERIFY_FROM = "verify@ngnhacks.ca"

# Exec-level titles we care about (substring match, case-insensitive).
EXEC_KEYWORDS = ("founder", "ceo", "cto", "coo", "president", "owner", "chief", "head", "vp", "partner")


# --------------------------------------------------------------------------- #
# 1. COMPANY DISCOVERY                                                          #
# --------------------------------------------------------------------------- #
def fetch_companies():
    req = urllib.request.Request(YC_ALL_COMPANIES, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.load(r)


def filter_companies(companies, industry=None, min_size=2, max_size=200):
    """Active startups with a real website, in a sane size band, optionally by industry."""
    out = []
    for c in companies:
        if c.get("status") not in ("Active", "Public", "Acquired", None):
            continue
        if not c.get("website"):
            continue
        size = c.get("team_size") or 0
        try:
            size = int(size)
        except (TypeError, ValueError):
            size = 0
        if size and not (min_size <= size <= max_size):
            continue
        if industry:
            blob = " ".join(str(c.get(k, "")) for k in ("industry", "subindustry", "tags", "one_liner")).lower()
            if industry.lower() not in blob:
                continue
        out.append(c)
    random.shuffle(out)
    return out


# --------------------------------------------------------------------------- #
# 2. PEOPLE DISCOVERY                                                           #
# --------------------------------------------------------------------------- #
def fetch_founders(slug):
    """Pull founder objects (name, title, linkedin) from a YC company page."""
    url = YC_PAGE.format(slug=slug)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        page = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "ignore")
    except Exception:
        return []
    m = re.search(r'data-page="(.*?)"\s*>', page, re.DOTALL)
    if not m:
        return []
    try:
        data = json.loads(ihtml.unescape(m.group(1)))
    except Exception:
        return []
    founders = _deep_find(data, "founders")
    if not isinstance(founders, list):
        return []
    people = []
    for f in founders:
        if not isinstance(f, dict):
            continue
        name = (f.get("full_name") or "").strip()
        if not name:
            continue
        people.append({
            "full_name": name,
            "title": (f.get("title") or "Founder").strip(),
            "linkedin_url": (f.get("linkedin_url") or "").strip(),
        })
    return people


def _deep_find(obj, key, depth=0):
    if depth > 7:
        return None
    if isinstance(obj, dict):
        if key in obj:
            return obj[key]
        for v in obj.values():
            r = _deep_find(v, key, depth + 1)
            if r is not None:
                return r
    elif isinstance(obj, list):
        for v in obj:
            r = _deep_find(v, key, depth + 1)
            if r is not None:
                return r
    return None


# --------------------------------------------------------------------------- #
# 3. EMAIL FINDING ENGINE                                                       #
# --------------------------------------------------------------------------- #
def domain_of(website):
    d = re.sub(r"^https?://", "", website.strip(), flags=re.I)
    d = d.split("/")[0].split("?")[0].strip().lower()
    if d.startswith("www."):
        d = d[4:]
    return d or None


def mx_hosts(domain):
    """MX records via Google DNS-over-HTTPS. Returns hosts sorted by priority."""
    try:
        url = DOH_RESOLVE.format(name=domain)
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/dns-json"})
        data = json.load(urllib.request.urlopen(req, timeout=15))
    except Exception:
        return []
    answers = data.get("Answer") or []
    mxs = []
    for a in answers:
        if a.get("type") != 15:  # MX
            continue
        parts = a.get("data", "").split()
        if len(parts) == 2:
            pri, host = parts
            try:
                mxs.append((int(pri), host.rstrip(".")))
            except ValueError:
                pass
    mxs.sort()
    return [h for _, h in mxs]


def name_parts(full_name):
    toks = [re.sub(r"[^a-z]", "", t.lower()) for t in full_name.split()]
    toks = [t for t in toks if t]
    if not toks:
        return None, None
    first = toks[0]
    last = toks[-1] if len(toks) > 1 else ""
    return first, last


def candidate_emails(full_name, domain):
    first, last = name_parts(full_name)
    if not first:
        return []
    if last:
        locals_ = [
            f"{first}.{last}", f"{first}{last}", f"{first}",
            f"{first[0]}{last}", f"{first}_{last}", f"{first[0]}.{last}", f"{last}",
        ]
    else:
        locals_ = [first]
    seen, out = set(), []
    for lp in locals_:
        if lp and lp not in seen:
            seen.add(lp)
            out.append(f"{lp}@{domain}")
    return out


def smtp_probe(mx_host, domain, candidates):
    """
    Open ONE SMTP conversation, stop before DATA (no email sent).
    Returns (verified_email_or_None, is_catch_all, reachable).
    """
    try:
        server = smtplib.SMTP(timeout=15)
        server.connect(mx_host, 25)
        server.helo(VERIFY_HELO)
        server.mail(VERIFY_FROM)
    except Exception:
        try:
            server.close()
        except Exception:
            pass
        return None, False, False

    # Catch-all detection: a random mailbox that cannot exist.
    rand = "".join(random.choices(string.ascii_lowercase, k=14)) + "@" + domain
    catch_all = False
    try:
        code, _ = server.rcpt(rand)
        if code in (250, 251):
            catch_all = True
    except Exception:
        pass

    verified = None
    if not catch_all:
        for cand in candidates:
            try:
                code, _ = server.rcpt(cand)
            except Exception:
                break
            if code in (250, 251):
                verified = cand
                break
            time.sleep(0.4)  # be polite to the mail server
    try:
        server.quit()
    except Exception:
        pass
    return verified, catch_all, True


def find_email(full_name, domain):
    """
    Returns dict: {email, confidence}
      confidence: 'verified' | 'catch_all_guess' | 'pattern_guess' | None
    """
    cands = candidate_emails(full_name, domain)
    if not cands:
        return {"email": "", "confidence": None}
    mxs = mx_hosts(domain)
    if not mxs:
        return {"email": "", "confidence": None}  # no mail server -> unusable domain

    verified, catch_all, reachable = (None, False, False)
    for mx in mxs[:2]:
        verified, catch_all, reachable = smtp_probe(mx, domain, cands)
        if reachable:
            break

    if verified:
        return {"email": verified, "confidence": "verified"}
    # Best-guess local part: startups overwhelmingly use first@ or first.last@.
    best = cands[0]
    if catch_all:
        return {"email": best, "confidence": "catch_all_guess"}
    return {"email": best, "confidence": "pattern_guess"}


# --------------------------------------------------------------------------- #
# 4. ASSEMBLY + OUTPUT                                                          #
# --------------------------------------------------------------------------- #
def split_location(all_locations):
    """'San Francisco, CA, USA' -> ('San Francisco', 'USA')."""
    if not all_locations:
        return "", ""
    first = all_locations.split(";")[0].strip()
    parts = [p.strip() for p in first.split(",") if p.strip()]
    if not parts:
        return "", ""
    city = parts[0]
    country = parts[-1] if len(parts) > 1 else ""
    return city, country


# leads.csv schema consumed by automation.py's get_apollo_leads()
CSV_FIELDS = [
    "First Name", "Last Name", "Email", "Title", "Organization Name",
    "Industry", "# Employees", "LinkedIn Url", "City", "Country",
    "Website", "Email Confidence",
]


def lead_row(company, founder, email_info):
    name = founder["full_name"]
    first, *rest = name.split()
    last = " ".join(rest)
    city, country = split_location(company.get("all_locations", ""))
    return {
        "First Name": first,
        "Last Name": last,
        "Email": email_info["email"],
        "Title": founder["title"],
        "Organization Name": company.get("name", ""),
        "Industry": company.get("industry", ""),
        "# Employees": company.get("team_size", ""),
        "LinkedIn Url": founder.get("linkedin_url", ""),
        "City": city,
        "Country": country,
        "Website": company.get("website", ""),
        "Email Confidence": email_info["confidence"] or "none",
    }


def pick_exec(founders):
    for f in founders:
        if any(k in f["title"].lower() for k in EXEC_KEYWORDS):
            return f
    return founders[0] if founders else None


def build_leads(count, industry, accept_guesses, max_companies):
    companies = filter_companies(fetch_companies(), industry=industry)
    print(f"[discovery] {len(companies)} candidate companies after filtering"
          + (f" (industry~'{industry}')" if industry else ""))

    leads, scanned = [], 0
    for c in companies:
        if len(leads) >= count or scanned >= max_companies:
            break
        scanned += 1
        slug = c.get("slug")
        domain = domain_of(c.get("website", ""))
        if not slug or not domain:
            continue

        founders = fetch_founders(slug)
        exec_ = pick_exec(founders)
        if not exec_:
            continue

        info = find_email(exec_["full_name"], domain)
        conf = info["confidence"]
        if conf is None:
            continue
        if conf != "verified" and not accept_guesses:
            continue

        row = lead_row(c, exec_, info)
        leads.append(row)
        tag = {"verified": "OK ", "catch_all_guess": "~CA", "pattern_guess": "~PG"}.get(conf, "?")
        print(f"  [{len(leads):>2}/{count}] {tag} {row['Email']:<34} "
              f"{exec_['full_name']} ({exec_['title']}) @ {c.get('name')}")
        time.sleep(0.5)

    print(f"[discovery] scanned {scanned} companies -> {len(leads)} leads")
    return leads


def write_csv(leads, path="leads.csv"):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        w.writeheader()
        for row in leads:
            w.writerow(row)
    print(f"[output] wrote {len(leads)} leads -> {path}")


def main():
    ap = argparse.ArgumentParser(description="OpenLeads - free founder/email lead engine")
    ap.add_argument("--count", type=int, default=20, help="how many leads to build")
    ap.add_argument("--industry", default=None, help="filter by YC industry/tag substring")
    ap.add_argument("--max-companies", type=int, default=400, help="scan budget")
    ap.add_argument("--verified-only", action="store_true", help="drop pattern/catch-all guesses")
    ap.add_argument("--no-write", action="store_true", help="print only, do not touch leads.csv")
    ap.add_argument("--out", default="leads.csv")
    args = ap.parse_args()

    print("=" * 64)
    print("  OpenLeads - free founder + email lead engine")
    print(f"  target: {args.count} leads | guesses: {'no' if args.verified_only else 'yes'}")
    print("=" * 64)

    leads = build_leads(
        count=args.count,
        industry=args.industry,
        accept_guesses=not args.verified_only,
        max_companies=args.max_companies,
    )

    if not leads:
        print("[!] No leads produced. Try without --verified-only or widen --industry.")
        sys.exit(1)

    from collections import Counter
    print("[summary] confidence:", dict(Counter(l["Email Confidence"] for l in leads)))

    if args.no_write:
        print("[output] --no-write set, leads.csv untouched.")
    else:
        write_csv(leads, args.out)


if __name__ == "__main__":
    main()
