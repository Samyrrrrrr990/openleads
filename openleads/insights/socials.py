"""
Social profiles from a company website — LinkedIn, X, Facebook, Instagram, YouTube,
GitHub, TikTok.

Company sites link their own profiles in the header or footer. We read every
``href`` on the page, keep the ones that point at a profile (not a share button or a
post), and normalize them, so a lead gets a company LinkedIn page the same way it
gets an email: from what the company published.
"""
from __future__ import annotations

import re
import urllib.parse

NETWORKS = ("linkedin", "twitter", "facebook", "instagram", "youtube", "github", "tiktok")

_HREF_RE = re.compile(r"""href\s*=\s*["']([^"'#\s]+)["']""", re.I)

# network → (host regex, path regex that marks a *profile* URL)
_RULES = {
    "linkedin": (r"(?:[a-z]{2,3}\.)?linkedin\.com",
                 r"^/(?:company|school|showcase|in)/[^/?]+"),
    "twitter": (r"(?:mobile\.)?(?:twitter|x)\.com", r"^/(?!intent|share|home|search|hashtag|i/)"
                r"[A-Za-z0-9_]{1,15}/?$"),
    "facebook": (r"(?:[a-z]{2,3}\.|m\.)?facebook\.com|fb\.com",
                 r"^/(?!sharer|share|dialog|plugins|tr|events/|groups/|watch)[^/?]+/?$"),
    "instagram": (r"(?:www\.)?instagram\.com", r"^/(?!p/|reel/|explore/|stories/)[^/?]+/?$"),
    "youtube": (r"(?:www\.|m\.)?youtube\.com",
                r"^/(?:@[^/?]+|c/[^/?]+|channel/[^/?]+|user/[^/?]+)/?$"),
    "github": (r"(?:www\.)?github\.com", r"^/(?!sponsors|features|about|login|join)[^/?]+/?$"),
    "tiktok": (r"(?:www\.)?tiktok\.com", r"^/@[^/?]+/?$"),
}
_COMPILED = {k: (re.compile(r"^(?:www\.)?" + h + r"$", re.I), re.compile(p))
             for k, (h, p) in _RULES.items()}


def classify_url(url: str) -> tuple:
    """``(network, canonical_url)`` if ``url`` is a social *profile*, else ``("", "")``."""
    raw = (url or "").strip()
    if raw.startswith("//"):
        raw = "https:" + raw
    if not re.match(r"^https?://", raw, re.I):
        return "", ""
    try:
        parts = urllib.parse.urlsplit(raw)
    except ValueError:
        return "", ""
    host = (parts.hostname or "").lower()
    path = parts.path or "/"
    for network, (host_rx, path_rx) in _COMPILED.items():
        if host_rx.match(host) and path_rx.search(path):
            return network, _canonical(network, host, path)
    return "", ""


def _canonical(network: str, host: str, path: str) -> str:
    path = re.sub(r"/+$", "", path)
    if network == "twitter":
        return "https://x.com" + path
    if network == "linkedin":
        # Keep only the profile part (/company/acme), not /company/acme/jobs.
        m = re.match(r"^/(company|school|showcase|in)/([^/?]+)", path)
        return f"https://www.linkedin.com/{m.group(1)}/{m.group(2)}" if m else ""
    base = {"facebook": "https://www.facebook.com", "instagram": "https://www.instagram.com",
            "youtube": "https://www.youtube.com", "github": "https://github.com",
            "tiktok": "https://www.tiktok.com"}[network]
    return base + path


def extract_socials(html_text: str) -> dict:
    """``{network: url}`` for each network the page links a profile on (first wins)."""
    out: dict = {}
    for m in _HREF_RE.finditer(html_text or ""):
        network, url = classify_url(m.group(1).replace("&amp;", "&"))
        if network and url and network not in out:
            out[network] = url
    return out
