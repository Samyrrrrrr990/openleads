"""
Phone numbers — normalize what sources give us and pull real numbers off websites.

OpenStreetMap carries a ``phone`` tag for many businesses, and most company sites
link their number as ``tel:``. Both are published, public business numbers, so a
lead gets a phone the same way it gets an email: from evidence, never invented.

Only high-precision places are read (``tel:`` links, JSON-LD ``telephone``, and a
"Phone:"/"Tel:" label), because a loose digit regex over a page mostly finds dates,
prices and zip codes.
"""
from __future__ import annotations

import html as ihtml
import re
import urllib.parse

_EXT_RE = re.compile(r"\s*(?:;?ext\.?=?|x|extension|#)\s*\d{1,6}\s*$", re.I)
_LABEL_RE = re.compile(
    r"(?:phone|tel(?:ephone)?|call(?: us)?|office|mobile|main)\s*(?:number)?\s*[:.\-]?\s*"
    r"(\+?\(?\d[\d\s().\-/]{6,20}\d)", re.I)
_TEL_RE = re.compile(r"""href\s*=\s*["']\s*tel:([^"']+)["']""", re.I)
_LD_TEL_RE = re.compile(r'"telephone"\s*:\s*"([^"]{5,40})"', re.I)


def normalize(raw: str) -> str:
    """Canonical digits: ``+<country><number>`` when international, else national digits.

    Returns '' for anything that isn't plausibly a phone number.
    """
    text = urllib.parse.unquote(str(raw or "")).strip()
    text = re.sub(r"^(?:tel|callto):(?://)?", "", text, flags=re.I).strip()
    if not text:
        return ""
    text = _EXT_RE.sub("", text)
    intl = text.startswith("+") or text.startswith("00")
    digits = re.sub(r"\D", "", text)
    if text.startswith("00"):
        digits = digits[2:]
    if not 7 <= len(digits) <= 15:
        return ""
    if len(set(digits)) <= 2:          # 0000000, 1212121 — placeholders
        return ""
    if intl:
        return "+" + digits
    if len(digits) == 11 and digits.startswith("1"):
        return "+" + digits            # 1-512-555-0100 is unambiguously NANP
    return digits


def display(phone: str) -> str:
    """A readable form: NANP as ``+1 512-555-0100``, others grouped after the code."""
    p = normalize(phone) if phone and not phone.startswith("+") else (phone or "")
    if not p:
        return ""
    digits = p.lstrip("+")
    if p.startswith("+1") and len(digits) == 11:
        return f"+1 {digits[1:4]}-{digits[4:7]}-{digits[7:]}"
    if not p.startswith("+") and len(digits) == 10:
        return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
    if p.startswith("+"):
        cc_len = 2 if digits[:2] in _TWO_DIGIT_CC else (1 if digits[0] == "7" else 3)
        cc, rest = digits[:cc_len], digits[cc_len:]
        groups = [rest[i:i + 3] for i in range(0, len(rest), 3)]
        if len(groups) > 1 and len(groups[-1]) == 1:
            groups[-2:] = [groups[-2] + groups[-1]]
        return f"+{cc} " + " ".join(groups)
    return p


# Two-digit country codes (common ones), so +44 20… groups as +44, not +442.
_TWO_DIGIT_CC = {
    "20", "27", "30", "31", "32", "33", "34", "36", "39", "40", "41", "43", "44", "45",
    "46", "47", "48", "49", "51", "52", "53", "54", "55", "56", "57", "58", "60", "61",
    "62", "63", "64", "65", "66", "81", "82", "84", "86", "90", "91", "92", "93", "94",
    "95", "98",
}


def split_tag(value: str) -> list:
    """An OSM ``phone`` tag can hold several numbers separated by ';' or ','."""
    out = []
    for part in re.split(r"[;,]|\s/\s", str(value or "")):
        p = normalize(part)
        if p and p not in out:
            out.append(p)
    return out


def extract_phones(html_text: str, limit: int = 5) -> list:
    """Published phone numbers on a page, most reliable first (pure)."""
    page = html_text or ""
    found: list = []

    def add(raw: str) -> None:
        p = normalize(ihtml.unescape(raw))
        if p and p not in found and _not_a_date(p):
            found.append(p)

    for m in _TEL_RE.finditer(page):
        add(m.group(1))
    for m in _LD_TEL_RE.finditer(page):
        add(m.group(1))
    if len(found) < limit:
        text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", page, flags=re.I | re.S)
        text = ihtml.unescape(re.sub(r"<[^>]+>", " ", text))
        for m in _LABEL_RE.finditer(text):
            add(m.group(1))
    return found[:limit]


def _not_a_date(digits: str) -> bool:
    d = digits.lstrip("+")
    # 20241015 / 15102024 read as phone-length digit runs; real numbers rarely do.
    return not (len(d) == 8 and (d.startswith(("19", "20")) or d[-4:-2] in ("19", "20")))
