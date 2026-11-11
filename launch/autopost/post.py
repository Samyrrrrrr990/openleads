"""Post new CHANGELOG entries to X and Bluesky, and a weekly dev.to draft.

Runs from .github/workflows/ship-notes.yml once a day. Official APIs only; each
platform is skipped when its secrets aren't set, and one failing platform never
stops the others. Reddit, Hacker News and LinkedIn are never posted to from here:
those go in launch/queue for a person to post.

    python launch/autopost/post.py --state launch/autopost/state.json --changelog CHANGELOG.md [--dry-run]
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import hashlib
import hmac
import json
import os
import secrets
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import notes  # noqa: E402

X_URL = "https://api.x.com/2/tweets"
BSKY = "https://bsky.social/xrpc/"
DEVTO_URL = "https://dev.to/api/articles"
X_KEYS = ("X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET")
BSKY_KEYS = ("BLUESKY_HANDLE", "BLUESKY_APP_PASSWORD")
UA = "openleads-ship-notes (+https://github.com/Samyrrrrrr990/openleads)"


def _http(method: str, url: str, headers: dict | None = None, body=None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("User-Agent", UA)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read().decode() or "{}"
    return json.loads(raw)


def _q(s: str) -> str:
    return urllib.parse.quote(str(s), safe="~")


def oauth1_header(method: str, url: str, keys: dict, nonce: str | None = None,
                  timestamp: str | None = None) -> str:
    """OAuth 1.0a user-context header (HMAC-SHA1). A JSON body isn't signed."""
    params = {
        "oauth_consumer_key": keys["X_API_KEY"],
        "oauth_nonce": nonce or secrets.token_hex(16),
        "oauth_signature_method": "HMAC-SHA1",
        "oauth_timestamp": timestamp or str(int(time.time())),
        "oauth_token": keys["X_ACCESS_TOKEN"],
        "oauth_version": "1.0",
    }
    base = "&".join((method.upper(), _q(url),
                     _q("&".join(f"{_q(k)}={_q(v)}" for k, v in sorted(params.items())))))
    key = f"{_q(keys['X_API_SECRET'])}&{_q(keys['X_ACCESS_SECRET'])}"
    sig = base64.b64encode(hmac.new(key.encode(), base.encode(), hashlib.sha1).digest()).decode()
    params["oauth_signature"] = sig
    return "OAuth " + ", ".join(f'{_q(k)}="{_q(v)}"' for k, v in sorted(params.items()))


def post_x(text: str, env: dict) -> str:
    _http("POST", X_URL, {"Authorization": oauth1_header("POST", X_URL, env)}, {"text": text})
    return "x"


def post_bluesky(text: str, env: dict) -> str:
    session = _http("POST", BSKY + "com.atproto.server.createSession", None,
                    {"identifier": env["BLUESKY_HANDLE"], "password": env["BLUESKY_APP_PASSWORD"]})
    record = {"$type": "app.bsky.feed.post", "text": text,
              "createdAt": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")}
    link = notes.REPO_URL
    if link in text:  # Bluesky only links a URL that has a facet over its UTF-8 bytes.
        start = len(text[: text.index(link)].encode())
        record["facets"] = [{"index": {"byteStart": start, "byteEnd": start + len(link.encode())},
                             "features": [{"$type": "app.bsky.richtext.facet#link", "uri": link}]}]
    _http("POST", BSKY + "com.atproto.repo.createRecord",
          {"Authorization": "Bearer " + session["accessJwt"]},
          {"repo": session["did"], "collection": "app.bsky.feed.post", "record": record})
    return "bluesky"


def devto_draft(week: list, env: dict, today: dt.date) -> str:
    body = ("What landed in OpenLeads this week:\n\n"
            + "\n".join("- " + notes.plain(e) for e in week)
            + f"\n\nOpenLeads is a free, local Apollo alternative: {notes.REPO_URL}\n")
    _http("POST", DEVTO_URL, {"api-key": env["DEVTO_API_KEY"]},
          {"article": {"title": f"OpenLeads this week ({today.isoformat()})",
                       "body_markdown": body, "published": False,
                       "tags": ["opensource", "python", "sales", "showdev"]}})
    return "devto"


def _have(env: dict, keys) -> bool:
    return all(env.get(k) for k in keys)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--state", required=True)
    ap.add_argument("--changelog", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    state_path = Path(args.state)
    state = json.loads(state_path.read_text())
    state.setdefault("posted", [])
    state.setdefault("week", [])
    state.setdefault("last_devto", "")
    entries = notes.new_entries(Path(args.changelog).read_text(), state["posted"])
    env = dict(os.environ)
    today = dt.date.today()

    if not entries:
        print("nothing new in [Unreleased]; not posting")
        return 0

    jobs = [("X", X_KEYS, 280, post_x), ("Bluesky", BSKY_KEYS, 300, post_bluesky)]
    if args.dry_run:
        for name, _, limit, _ in jobs:
            print(f"--- {name} ---\n{notes.compose(entries, limit)}\n")
        return 0

    done = []
    for name, keys, limit, fn in jobs:
        if not _have(env, keys):
            print(f"{name}: skipped (secrets not set)")
            continue
        try:
            done.append(fn(notes.compose(entries, limit), env))
            print(f"{name}: posted")
        except Exception as e:  # noqa: BLE001 one platform failing never stops the others
            print(f"{name}: failed ({e})")

    if done:
        state["posted"] += entries
        state["week"] += entries

    last = dt.date.fromisoformat(state["last_devto"]) if state["last_devto"] else None
    if (state["week"] and today.weekday() == 0 and _have(env, ("DEVTO_API_KEY",))
            and (last is None or (today - last).days > 6)):
        try:
            devto_draft(state["week"], env, today)
            state["week"], state["last_devto"] = [], today.isoformat()
            print("dev.to: draft created")
        except Exception as e:  # noqa: BLE001
            print(f"dev.to: failed ({e})")

    if done or state["last_devto"] == today.isoformat():
        state_path.write_text(json.dumps(state, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
