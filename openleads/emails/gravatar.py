"""
Gravatar existence check — a free, port-25-free signal that a *human* registered
an exact address.

Millions of people attach a Gravatar to the email they actually use (it powers
avatars on GitHub, WordPress, Stack Overflow, and countless apps). A hit is strong
corroboration that an address is real and in use — and unlike SMTP it needs no
outbound port 25, so it works from any laptop behind any ISP.

``GET https://www.gravatar.com/avatar/<md5(email)>?d=404`` returns **200** when an
avatar exists for that address and **404** when it does not.
"""
from __future__ import annotations

import hashlib
import urllib.error
import urllib.request

from openleads.config import USER_AGENT


def email_hash(email: str) -> str:
    """Gravatar's identifier: md5 of the trimmed, lowercased address."""
    return hashlib.md5((email or "").strip().lower().encode("utf-8")).hexdigest()


def has_gravatar(email: str, cache=None, timeout: int = 10) -> bool | None:
    """Return True if a Gravatar exists for ``email``, False if not, None if unknown.

    Cached under the ``gravatar`` namespace. ``None`` means we couldn't tell (network
    error) and should be treated as *no signal* — never as a negative.
    """
    if not email or "@" not in email:
        return None
    if cache is not None:
        hit = cache.get("gravatar", email.lower())
        if hit is not None:
            return hit
    url = f"https://www.gravatar.com/avatar/{email_hash(email)}?d=404&s=80"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    result: bool | None
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            result = r.status == 200
    except urllib.error.HTTPError as e:
        result = False if e.code == 404 else None
    except (urllib.error.URLError, OSError, ValueError):
        result = None
    if cache is not None and result is not None:
        cache.set("gravatar", email.lower(), result)
    return result
