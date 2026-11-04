"""
The run context every node receives, and the *services* nodes call out to.

A node's run function is ``fn(ctx, params, items) -> {port: items}``. Everything
with a side effect (searching, sending, exporting, writing an email, notifying)
goes through ``ctx.svc(name)``, so tests swap in fakes and a test run can prove it
never touched the outside world. The defaults below are thin adapters over the
modules the rest of OpenLeads already uses; when another part of the code base
changes its internals (the email writer, the sender), only the adapter moves.
"""
from __future__ import annotations

import time
from datetime import datetime

TEST = "test"     # dry run: never sends, never exports, never writes to the workspace
RUN = "run"       # a real run: workspace writes + exports; sends only when ``live``


# --------------------------------------------------------------------------- #
# Lead dict helpers                                                            #
# --------------------------------------------------------------------------- #
def lead_dict(lead) -> dict:
    """A lead (``Lead`` or dict) as a plain item dict with ``name`` and ``domain``."""
    d = dict(lead) if isinstance(lead, dict) else lead.to_dict()
    email = (d.get("email") or "").strip().lower()
    if email:
        d["email"] = email
    if not d.get("domain"):
        if "@" in email:
            d["domain"] = email.split("@", 1)[1]
        else:
            site = (d.get("website") or "").lower()
            site = site.replace("https://", "").replace("http://", "").split("/")[0]
            d["domain"] = site[4:] if site.startswith("www.") else site
    if not d.get("name"):
        d["name"] = " ".join(p for p in (d.get("first_name"), d.get("last_name")) if p) \
            or d.get("organization") or ""
    return d


def item_key(item: dict) -> str:
    """Identity used to merge branches without duplicating a lead."""
    return (item.get("email") or "").lower() or (item.get("domain") or "") or str(id(item))


def public_item(item: dict) -> dict:
    """An item without executor-internal keys (``_``-prefixed), for exports/webhooks."""
    return {k: v for k, v in item.items() if not str(k).startswith("_")}


# --------------------------------------------------------------------------- #
# Default services (thin adapters)                                             #
# --------------------------------------------------------------------------- #
def _build_leads(query, cache=None, db=None, on_progress=None):
    from openleads.engine import build_leads
    return build_leads(query, cache=cache, db=db, on_progress=on_progress or (lambda *_: None))


def _parse_query(text: str):
    from openleads import intent
    if not text:
        return intent.rule_parse("")
    return intent.parse(text)[0]


def write_email(lead: dict, pitch: str = "", template: str = "", db=None) -> dict:
    """Draft one email for ``lead``. Returns ``{subject, body, lint, model}``.

    The adapter between workflows and the email writer: a saved workspace template
    when ``template`` names one, otherwise the writer's own drafting (LLM when a key
    is configured, a plain-text template when not). Only this function knows the
    writer's API, so an upgraded writer drops in here.
    """
    overrides = {"sender_context": pitch} if pitch else None
    if template and db is not None:
        from openleads.workspace import templates as tplmod
        tpl = _template_by_name(db, template)
        if tpl is None:
            raise ValueError(f"no email template named '{template}'")
        draft, _missing = tplmod.render_draft(tpl["subject"], tpl["body"], lead, overrides)
        return draft.to_dict()
    from openleads.outreach import compose
    draft = compose.draft(lead, overrides)
    return draft.to_dict() if hasattr(draft, "to_dict") else dict(draft)


def _template_by_name(db, name: str):
    from openleads.workspace import templates as tplmod
    for t in tplmod.list_templates(db):
        if str(t.get("name", "")).lower() == str(name).lower() or str(t.get("id")) == str(name):
            return t
    return None


def _send_drafts(drafts, dry_run=True, db=None, campaign="default", on_progress=None):
    from openleads.models import Draft
    from openleads.outreach import sender
    objs = [d if isinstance(d, Draft) else Draft(
        email=d.get("email", ""), subject=d.get("subject", ""), body=d.get("body", ""),
        first_name=d.get("first_name", ""), organization=d.get("organization", ""),
        lint=d.get("lint") or {}, model=d.get("model", "")) for d in drafts]
    return sender.send_drafts(objs, dry_run=dry_run, db=db, campaign=campaign,
                              on_progress=on_progress or (lambda _r: None))


def _export(leads, sink="csv", target=None):
    from openleads.automate import exporters
    return exporters.export(leads, sink=sink, target=target or None)


def _enrich_rows(rows, cache=None, db=None, deep=False, on_progress=None):
    from openleads import enrich
    return enrich.enrich_rows(rows, cache=cache, db=db, deep=deep,
                              on_progress=on_progress or (lambda *_: None))


def _fetch_profile(domain, cache=None):
    from openleads.insights.company import fetch_profile
    return fetch_profile(domain, cache=cache)


def _verify_address(email, cache=None, db=None):
    from openleads.emails.resolve import verify_address
    return verify_address(email, cache=cache, db=db)


def _notify(title: str, message: str, channel: str = "desktop", url: str = "") -> dict:
    """Desktop alert and/or a JSON POST. Never raises; returns what was attempted."""
    import json
    import urllib.request

    from openleads import settings
    from openleads.automate import history
    out = {"desktop": False, "webhook": ""}
    if channel in ("desktop", "both"):
        history._desktop(title, message)
        out["desktop"] = True
    hook = url or (settings.get("notify_webhook") or "")
    if channel in ("webhook", "both") and hook:
        body = json.dumps({"text": f"{title}: {message}", "title": title,
                           "message": message}).encode()
        req = urllib.request.Request(hook, data=body, method="POST",
                                     headers={"Content-Type": "application/json"})
        try:
            urllib.request.urlopen(req, timeout=10).close()
            out["webhook"] = "sent"
        except Exception as e:  # noqa: BLE001 — a notification must never break a run
            out["webhook"] = f"failed: {e}"
    return out


def _inbox_scan(db):
    from openleads import settings
    if not (settings.get("imap_host") or settings.get("smtp_user")):
        return {"skipped": "no mailbox configured"}
    from openleads.outreach import inbox
    return inbox.scan(db=db)


def _in_send_window(now: datetime) -> bool:
    from openleads.automate.sendtime import in_send_window
    return in_send_window(now)


def _next_send_slot(now: datetime) -> datetime:
    from openleads.automate.sendtime import SendPolicy, next_slot
    return next_slot(now, SendPolicy())


DEFAULT_SERVICES = {
    "build_leads": _build_leads,
    "parse_query": _parse_query,
    "write_email": write_email,
    "send_drafts": _send_drafts,
    "export": _export,
    "enrich_rows": _enrich_rows,
    "fetch_profile": _fetch_profile,
    "verify_address": _verify_address,
    "notify": _notify,
    "inbox_scan": _inbox_scan,
    "in_send_window": _in_send_window,
    "next_send_slot": _next_send_slot,
}


# --------------------------------------------------------------------------- #
# The context                                                                  #
# --------------------------------------------------------------------------- #
class Context:
    """What a node can see and do while it runs."""

    def __init__(self, db, workflow: dict, mode: str = TEST, live: bool = False, cache=None,
                 services: dict | None = None, now: datetime | None = None, emit=None,
                 run_id: int | None = None, state: dict | None = None,
                 trigger: dict | None = None):
        self.db = db
        self.cache = cache
        self.workflow = workflow
        self.mode = mode
        self.live = bool(live) and mode == RUN
        self.services = {**DEFAULT_SERVICES, **(services or {})}
        self.now = now or datetime.now()
        self._emit = emit
        self.run_id = run_id
        self.state = state if state is not None else {}
        self.trigger = trigger or {}
        self.vars: dict = {}
        self.node: dict = {}
        self.notes: list = []
        self.parked: list = []       # (node_id, items, wake_at) to persist after the run

    @property
    def test(self) -> bool:
        return self.mode == TEST

    @property
    def name(self) -> str:
        return self.workflow.get("name", "")

    def svc(self, name: str):
        return self.services[name]

    def emit(self, event: dict) -> None:
        """Stream one progress event. A listener that went away (the browser tab was
        closed) is dropped, and the run carries on so it finishes and is logged."""
        if self._emit is None:
            return
        try:
            self._emit(event)
        except Exception:  # noqa: BLE001 — a bad listener must never stop a run
            self._emit = None

    def note(self, text: str) -> None:
        """A one-line, human explanation of what this node did (shown in the run log)."""
        self.notes.append(text)
        self.emit({"type": "log", "node": self.node.get("id", ""), "message": text})

    def phase(self, text: str) -> None:
        self.emit({"type": "phase", "node": self.node.get("id", ""), "message": str(text)})

    def park(self, items: list, wake_at: float) -> None:
        """Hold ``items`` at the current node until ``wake_at`` (a Unix timestamp)."""
        self.parked.append((self.node.get("id", ""), items, float(wake_at)))

    def timestamp(self) -> float:
        return self.now.timestamp() if self.now else time.time()
