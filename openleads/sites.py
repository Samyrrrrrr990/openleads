"""
Sites: demo websites built in Studio (the drag-and-drop editor at ``/studio/``).

The web-agency loop: find businesses whose websites are weak, build each one a
better site in Studio (a template filled in from the lead in one click), and send
the owner a link to it. ``{{site_url}}`` in a template or sequence is that link.

Studio stores every project here, in the ``sites`` table: ``data`` is the project
graph (the editor's source of truth), ``html`` the rendered pages Studio produces on
each save (``{"/": "<!doctype html>…", "/about": …}``). The local server shows them
at ``/s/<slug>/``; :func:`publish` writes them as a static folder you can put on any
host, and deploys to Netlify when a ``netlify_token`` is set. The public link a lead
gets is the Netlify URL, or ``site_base_url`` + slug if you host the folder yourself.
"""
from __future__ import annotations

import io
import json
import re
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

from openleads import settings
from openleads.config import home

MAX_PAGES = 40
SLUG_RE = re.compile(r"[^a-z0-9]+")
ID_RE = re.compile(r"^[\w-]{4,64}$")


def slugify(text: str) -> str:
    s = SLUG_RE.sub("-", (text or "").lower()).strip("-")[:48].strip("-")
    return s or "site"


def _unique_slug(db, base: str, site_id: str) -> str:
    slug, n = base, 2
    while True:
        row = db.query_one("SELECT id FROM sites WHERE slug=?", (slug,))
        if not row or row["id"] == site_id:
            return slug
        slug = f"{base}-{n}"
        n += 1


def _summary(row: dict) -> dict:
    out = {k: row.get(k) for k in ("id", "slug", "name", "lead_email", "company", "starter_id",
                                   "page_count", "node_count", "published_url", "created",
                                   "updated")}
    out["preview"] = f"/s/{row['slug']}/"
    out["url"] = public_url(row)
    return out


def public_url(row: dict) -> str:
    """The link a lead can open: the published URL, or your own host + slug."""
    if row.get("published_url"):
        return row["published_url"]
    base = (settings.get("site_base_url") or "").strip().rstrip("/")
    return f"{base}/{row['slug']}/" if base else ""


def list_sites(db, lead: str = "") -> list:
    sql = "SELECT * FROM sites"
    params: tuple = ()
    if lead:
        sql += " WHERE lead_email=?"
        params = (lead.lower().strip(),)
    out = [_summary(r) for r in db.query(sql + " ORDER BY updated DESC", params)]
    for site in out:
        site["sent"] = bool(db.kv_get(f"sites.sent.{site['id']}"))
    return out


def get(db, site_id: str) -> dict | None:
    row = db.query_one("SELECT * FROM sites WHERE id=?", (site_id,))
    if not row:
        return None
    out = _summary(row)
    try:
        out["project"] = json.loads(row["data"])
    except ValueError:
        out["project"] = None
    out["log"] = db.kv_get(f"sites.log.{site_id}") or []
    out["sent"] = db.kv_get(f"sites.sent.{site_id}") or None
    return out


LOG_MAX = 120


def add_log(db, site_id: str, lines: list) -> list:
    """Remember what happened to a site (built, Claude's edits, sent), newest last."""
    if not db.query_one("SELECT id FROM sites WHERE id=?", (site_id,)):
        raise ValueError("no such site")
    now = time.time()
    keep = [{"text": str(x.get("text") or "")[:400], "kind": str(x.get("kind") or "info")[:20],
             "ts": now}
            for x in (lines or []) if isinstance(x, dict) and str(x.get("text") or "").strip()]
    log = (db.kv_get(f"sites.log.{site_id}") or []) + keep
    db.kv_set(f"sites.log.{site_id}", log[-LOG_MAX:])
    return log[-LOG_MAX:]


def by_slug(db, slug: str) -> dict | None:
    return db.query_one("SELECT * FROM sites WHERE slug=?", (slug,))


def _clean_html(html) -> dict:
    if not isinstance(html, dict):
        return {}
    out = {}
    for route, page in list(html.items())[:MAX_PAGES]:
        if not isinstance(route, str) or not isinstance(page, str):
            continue
        route = "/" + route.strip("/")
        if not re.fullmatch(r"/[\w\-/]*", route) or ".." in route:
            continue
        out[route] = page
    return out


def save(db, project: dict, starter_id=None, lead: str = "", html=None) -> dict:
    """Create or update a site from Studio's project graph (and its rendered pages)."""
    if not isinstance(project, dict):
        raise ValueError("project must be an object")
    site_id = str(project.get("id") or "")
    if not ID_RE.match(site_id):
        raise ValueError("project id is missing or malformed")
    name = str(project.get("name") or "Untitled site").strip()[:120] or "Untitled site"
    pages = project.get("pages") if isinstance(project.get("pages"), list) else []
    nodes = project.get("nodes") if isinstance(project.get("nodes"), dict) else {}
    now = time.time()
    old = db.query_one("SELECT * FROM sites WHERE id=?", (site_id,))
    lead = (lead or (old or {}).get("lead_email") or "").lower().strip()
    company = (old or {}).get("company") or ""
    if lead and not company:
        row = db.query_one("SELECT organization FROM leads WHERE email=?", (lead,))
        company = (row or {}).get("organization") or ""
    slug = (old or {}).get("slug") or _unique_slug(db, slugify(company or name), site_id)
    clean = _clean_html(html)
    html_json = json.dumps(clean) if clean else (old or {}).get("html")
    data = json.dumps(project)
    if old:
        db.execute("UPDATE sites SET name=?, lead_email=?, company=?, starter_id=COALESCE(?, starter_id), "
                   "data=?, html=?, page_count=?, node_count=?, updated=? WHERE id=?",
                   (name, lead or None, company, starter_id, data, html_json, len(pages),
                    len(nodes), now, site_id))
    else:
        db.execute("INSERT INTO sites (id, slug, name, lead_email, company, starter_id, data, html, "
                   "page_count, node_count, created, updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                   (site_id, slug, name, lead or None, company, starter_id, data, html_json,
                    len(pages), len(nodes), now, now))
        if lead:
            try:
                from openleads.workspace import activity
                activity.log(db, "contact", lead, "site", f"Demo site built: {name}",
                             {"site": site_id, "slug": slug})
            except Exception:  # noqa: BLE001 — the timeline is a nicety
                pass
    return _summary(db.query_one("SELECT * FROM sites WHERE id=?", (site_id,)))


def rename(db, site_id: str, name: str) -> dict:
    name = (name or "").strip()[:120]
    if not name:
        raise ValueError("a site needs a name")
    row = db.query_one("SELECT data FROM sites WHERE id=?", (site_id,))
    if not row:
        raise ValueError("no such site")
    data = json.loads(row["data"])
    data["name"] = name
    data["updatedAt"] = int(time.time() * 1000)
    db.execute("UPDATE sites SET name=?, data=?, updated=? WHERE id=?",
               (name, json.dumps(data), time.time(), site_id))
    return _summary(db.query_one("SELECT * FROM sites WHERE id=?", (site_id,)))


def link_lead(db, site_id: str, lead: str) -> dict:
    lead = (lead or "").lower().strip()
    db.execute("UPDATE sites SET lead_email=?, updated=? WHERE id=?", (lead or None, time.time(), site_id))
    row = db.query_one("SELECT * FROM sites WHERE id=?", (site_id,))
    if not row:
        raise ValueError("no such site")
    return _summary(row)


def delete(db, site_id: str) -> bool:
    return db.execute("DELETE FROM sites WHERE id=?", (site_id,)).rowcount > 0


def page_html(row: dict, route: str) -> str | None:
    try:
        pages = json.loads(row.get("html") or "{}")
    except ValueError:
        return None
    route = "/" + (route or "").strip("/")
    return pages.get(route) or (pages.get("/") if route in ("/index.html", "/") else None)


def url_for_email(email: str, db=None) -> str:
    """The public demo-site link for a lead (``{{site_url}}``), or ''."""
    from openleads.db import DB
    own = db is None
    db = db or DB()
    try:
        row = db.query_one("SELECT * FROM sites WHERE lead_email=? ORDER BY updated DESC LIMIT 1",
                           ((email or "").lower().strip(),))
        return public_url(row) if row else ""
    finally:
        if own:
            db.close()


def lead_brief(db, email: str) -> dict | None:
    """What Studio pre-fills a template with: the business, its city, phone, site."""
    from openleads.workspace import people
    c = people.get(db, email)
    if not c:
        return None
    raw = db.query_one("SELECT data FROM leads WHERE email=?", (c["email"],)) or {}
    try:
        data = json.loads(raw.get("data") or "{}")
    except ValueError:
        data = {}
    name = c.get("organization") or data.get("organization") or c.get("name") or ""
    return {"email": c["email"], "business": name, "contact": c.get("name") or "",
            "city": c.get("city") or data.get("city") or "",
            "phone": c.get("phone") or data.get("phone") or "",
            "website": data.get("website") or (f"https://{c['domain']}" if c.get("domain") else ""),
            "industry": c.get("industry") or data.get("industry") or data.get("category") or "",
            "address": data.get("address") or ""}


# --------------------------------------------------------------------------- #
# Sending the site to the lead                                                 #
# --------------------------------------------------------------------------- #
LINK = "{{site_url}}"


def _first(name: str) -> str:
    first = (name or "").strip().split(" ")[0]
    return first if first[:1].isalpha() else ""


def email_for(db, site_id: str) -> dict:
    """A short first email offering the site. ``{{site_url}}`` becomes the link on send."""
    row = db.query_one("SELECT * FROM sites WHERE id=?", (site_id,))
    if not row:
        raise ValueError("no such site")
    lead = (row.get("lead_email") or "").strip()
    brief = lead_brief(db, lead) if lead else None
    business = (brief or {}).get("business") or row.get("company") or row.get("name") or ""
    city = (brief or {}).get("city") or ""
    hi = _first((brief or {}).get("contact") or "")
    me = (settings.get("sender_name") or "").strip()
    body = "\n".join([
        f"Hi {hi}," if hi else "Hi,",
        "",
        f"I put together a new website for {business}{' in ' + city if city else ''}, "
        "to show what it could look like:",
        "",
        LINK,
        "",
        "It's yours if you'd like it. I can change anything on it and get it live on "
        "your own address.",
        "",
        "Worth a quick call this week?",
        *(["", me] if me else []),
    ])
    url = public_url(row)
    return {"to": lead, "name": (brief or {}).get("contact") or "", "business": business,
            "subject": f"A new website for {business}" if business else "A new website for you",
            "body": body, "url": url,
            "can_publish": bool(url or settings.get("netlify_token") or settings.get("site_base_url")),
            "sent": db.kv_get(f"sites.sent.{site_id}") or None}


def send(db, site_id: str, subject: str, body: str) -> dict:
    """Publish the site if it isn't live yet, then email the lead its link.

    Goes through the approval queue and the normal sender, so suppression, warm-up
    limits and the pre-send hook all apply; a send that can't happen now (warm-up
    cap, mailbox down) stays waiting in Today instead of being lost.
    """
    from openleads.models import Draft
    from openleads.workspace import drafts
    row = db.query_one("SELECT * FROM sites WHERE id=?", (site_id,))
    if not row:
        raise ValueError("no such site")
    to = (row.get("lead_email") or "").strip().lower()
    if not to:
        raise ValueError("this site isn't for a lead yet")
    subject, body = (subject or "").strip(), (body or "").strip()
    if not subject or not body:
        raise ValueError("the email needs a subject and a message")
    url = public_url(row)
    if not row.get("published_url") and (settings.get("netlify_token") or settings.get("site_base_url")):
        url = publish(db, site_id).get("url") or url
    if (LINK in subject or LINK in body) and not url:
        raise ValueError("this site has no public link yet: add a Netlify token or your "
                         "site address in Settings, then send")
    subject, body = subject.replace(LINK, url), body.replace(LINK, url)
    step = 2 if db.scalar("SELECT 1 FROM touches WHERE email=? AND status='sent' LIMIT 1",
                          (to,)) else 1
    queued = drafts.enqueue(db, Draft(email=to, subject=subject, body=body, step=step), "site",
                            {"campaign": "sites", "step": step, "site": site_id})
    res = drafts.approve(db, queued["id"])
    if res.get("status") == "sent":
        db.kv_set(f"sites.sent.{site_id}", {"to": to, "ts": time.time(), "url": url})
        add_log(db, site_id, [{"text": f"Sent to {to}", "kind": "sent"}])
    elif res.get("detail"):
        add_log(db, site_id, [{"text": f"Not sent yet: {res['detail']}", "kind": "info"}])
    return {**res, "url": url, "draft_id": queued["id"]}


# --------------------------------------------------------------------------- #
# Publishing                                                                   #
# --------------------------------------------------------------------------- #
def _files(row: dict) -> dict:
    """{relative path: html} for a static host: "/" → index.html, "/about" → about/index.html."""
    pages = json.loads(row.get("html") or "{}")
    out = {}
    for route, html in pages.items():
        rel = "index.html" if route == "/" else route.strip("/") + "/index.html"
        out[rel] = html
    return out


def export_folder(db, site_id: str, dest: Path | None = None) -> Path:
    row = db.query_one("SELECT * FROM sites WHERE id=?", (site_id,))
    if not row:
        raise ValueError("no such site")
    files = _files(row)
    if not files:
        raise ValueError("open the site in Studio once so its pages are rendered")
    folder = Path(dest) if dest else home() / "sites" / row["slug"]
    folder.mkdir(parents=True, exist_ok=True)
    for rel, html in files.items():
        p = folder / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(html, encoding="utf-8")
    return folder


def _zip(files: dict) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for rel, html in files.items():
            z.writestr(rel, html)
    return buf.getvalue()


def _netlify(method: str, path: str, token: str, body: bytes | None = None,
             ctype: str = "application/json") -> dict:
    req = urllib.request.Request(f"https://api.netlify.com/api/v1{path}", data=body, method=method,
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": ctype,
                                          "User-Agent": "openleads"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:200]
        raise RuntimeError(f"Netlify said {e.code}: {detail}") from None


def publish(db, site_id: str) -> dict:
    """Write the static folder; deploy it to Netlify when a token is set."""
    folder = export_folder(db, site_id)
    row = db.query_one("SELECT * FROM sites WHERE id=?", (site_id,))
    token = settings.get("netlify_token") or ""
    out = {"folder": str(folder), "url": public_url(row), "deployed": False}
    if not token:
        add_log(db, site_id, [{"text": f"Published at {out['url']}" if out["url"]
                               else f"Exported to {folder}", "kind": "publish"}])
        return out
    netlify_id = db.kv_get(f"sites.netlify.{site_id}")
    if not netlify_id:
        import secrets as _s
        made = _netlify("POST", "/sites", token,
                        json.dumps({"name": f"{row['slug']}-{_s.token_hex(3)}"}).encode())
        netlify_id = made.get("id")
        db.kv_set(f"sites.netlify.{site_id}", netlify_id)
    deploy = _netlify("POST", f"/sites/{netlify_id}/deploys", token, _zip(_files(row)),
                      "application/zip")
    url = deploy.get("ssl_url") or deploy.get("url") or ""
    site_info = _netlify("GET", f"/sites/{netlify_id}", token)
    url = site_info.get("ssl_url") or site_info.get("url") or url
    if url:
        url = url.rstrip("/") + "/"
        db.execute("UPDATE sites SET published_url=?, updated=? WHERE id=?", (url, time.time(), site_id))
    out.update({"url": url, "deployed": True})
    add_log(db, site_id, [{"text": f"Live on Netlify at {url}" if url else "Deployed to Netlify",
                           "kind": "publish"}])
    return out
