"""
Workflow templates — ready-made graphs for ``openleads workflow new --from NAME``
and the dashboard's *New workflow* menu. Each one is valid as shipped; audiences
and pitches are placeholders you change before activating.
"""
from __future__ import annotations

import copy


def _n(id_, type_, x, y, **params) -> dict:
    return {"id": id_, "type": type_, "params": params, "position": {"x": x, "y": y}}


def _e(a, b, port="out") -> dict:
    return {"from": a, "from_port": port, "to": b}


TEMPLATES = [
    {
        "key": "local-business-outreach",
        "title": "Local business outreach",
        "description": "Every weekday morning: find local businesses, skip anyone already "
                       "emailed, write and send to the deliverable ones, park risky ones in a "
                       "review list.",
        "nodes": [
            _n("trigger", "trigger.schedule", 40, 200, schedule="weekdays 09:00"),
            _n("find", "find", 280, 200, query="dentists in Austin, TX", count=40,
               verified_only=False),
            _n("split", "split_tier", 520, 200),
            _n("dedupe", "dedupe", 760, 80, skip_contacted=True, per_company=True),
            _n("limit", "limit", 1000, 80, max=20, sort_by="fit_score"),
            _n("write", "write", 1240, 80, pitch="a free audit of your Google Maps listing"),
            _n("send", "send", 1480, 80),
            _n("review", "add_to_list", 760, 320, list="Needs review"),
        ],
        "edges": [_e("trigger", "find"), _e("find", "split"), _e("split", "dedupe", "safe"),
                  _e("dedupe", "limit"), _e("limit", "write"), _e("write", "send"),
                  _e("split", "review", "risky")],
    },
    {
        "key": "founder-outreach",
        "title": "Founder outreach with a LinkedIn touch",
        "description": "Find founders, keep the decision makers, email them and queue a "
                       "LinkedIn connect task for the next day.",
        "nodes": [
            _n("trigger", "trigger.manual", 40, 200),
            _n("find", "find", 280, 200, query="fintech founders in London", count=30),
            _n("senior", "filter", 520, 200, match="any", conditions=[
                {"field": "seniority", "op": "in", "value": "founder, owner, c_suite"}]),
            _n("dedupe", "dedupe", 760, 120),
            _n("write", "write", 1000, 120, pitch="a 20 minute walkthrough of our compliance API"),
            _n("send", "send", 1240, 120),
            _n("linkedin", "create_task", 1480, 120,
               title="Connect with {{first_name}} on LinkedIn", kind="linkedin",
               due="tomorrow", priority="normal"),
            _n("later", "tag", 760, 320, tags="not-a-founder"),
        ],
        "edges": [_e("trigger", "find"), _e("find", "senior"), _e("senior", "dedupe", "true"),
                  _e("dedupe", "write"), _e("write", "send"), _e("send", "linkedin"),
                  _e("senior", "later", "false")],
    },
    {
        "key": "inbound-reply",
        "title": "Reply received: task and stage",
        "description": "When someone replies, good-fit contacts move to Interested and get a "
                       "call task today; everyone else gets tagged for a later look.",
        "nodes": [
            _n("trigger", "trigger.reply", 40, 200, scan_inbox=True, lookback_days=7),
            _n("fit", "filter", 280, 200, match="any", conditions=[
                {"field": "fit_grade", "op": "in", "value": "A, B"}]),
            _n("stage", "set_stage", 520, 100, stage="interested"),
            _n("call", "create_task", 760, 100, title="Call {{first_name}} at {{company}}",
               kind="call", due="today", priority="high",
               note="They replied to your outreach."),
            _n("tag", "tag", 520, 320, tags="replied-low-fit"),
        ],
        "edges": [_e("trigger", "fit"), _e("fit", "stage", "true"), _e("stage", "call"),
                  _e("fit", "tag", "false")],
    },
    {
        "key": "weekly-digest-sheets",
        "title": "Weekly new-leads digest to Sheets",
        "description": "Every Monday, look for companies you haven't seen before, look them "
                       "up, write them to a Sheets-ready CSV and tell you how many there are.",
        "nodes": [
            _n("trigger", "trigger.new_leads", 40, 200, query="new marketing agencies in Miami",
               count=50, schedule="mon 08:30"),
            _n("lookup", "lookup_company", 280, 200, max=50),
            _n("sheet", "export", 520, 200, sink="sheets", target=""),
            _n("notify", "notify", 760, 200, title="OpenLeads weekly digest",
               message="{count} new leads this week", channel="desktop"),
        ],
        "edges": [_e("trigger", "lookup"), _e("lookup", "sheet"), _e("sheet", "notify")],
    },
    {
        "key": "re-engage-unresponsive",
        "title": "Re-engage unresponsive contacts",
        "description": "Once a week, pick contacts who went quiet more than 30 days ago, send "
                       "a short check-in, and if they still don't answer in 5 days, make a "
                       "call task.",
        "nodes": [
            _n("trigger", "trigger.schedule", 40, 200, schedule="tue 10:00"),
            _n("load", "contacts", 280, 200, stage="unresponsive", contacted="older", days=30,
               limit=25),
            _n("dedupe", "dedupe", 520, 200, skip_contacted=True, within_days=30),
            _n("write", "write", 760, 200,
               pitch="a short check-in: is this still a priority for you this quarter?"),
            _n("send", "send", 1000, 200),
            _n("wait", "wait", 1240, 200, days=5, business_hours=True, stop_on_reply=True),
            _n("call", "create_task", 1480, 200, title="Call {{first_name}}, no reply to check-in",
               kind="call", due="today"),
        ],
        "edges": [_e("trigger", "load"), _e("load", "dedupe"), _e("dedupe", "write"),
                  _e("write", "send"), _e("send", "wait"), _e("wait", "call")],
    },
    {
        "key": "enrich-csv-hubspot",
        "title": "Enrich a CSV into HubSpot",
        "description": "Run by hand: find and verify emails for a CSV of names and companies, "
                       "push the deliverable ones to HubSpot and list the rest for review.",
        "nodes": [
            _n("trigger", "trigger.manual", 40, 200),
            _n("enrich", "enrich", 280, 200, source="csv", path="~/Downloads/people.csv"),
            _n("split", "split_tier", 520, 200),
            _n("hubspot", "export", 760, 100, sink="hubspot"),
            _n("review", "add_to_list", 760, 300, list="Enriched: needs review"),
        ],
        "edges": [_e("trigger", "enrich"), _e("enrich", "split"), _e("split", "hubspot", "safe"),
                  _e("split", "review", "risky")],
    },
    {
        "key": "drip-with-follow-up",
        "title": "Email, wait, then call",
        "description": "Find, email the safe leads, wait three business days and turn anyone "
                       "who hasn't replied into a call task.",
        "nodes": [
            _n("trigger", "trigger.schedule", 40, 200, schedule="mon,wed 09:30"),
            _n("find", "find", 280, 200, query="IT managed service providers in Denver",
               count=25),
            _n("dedupe", "dedupe", 520, 200),
            _n("write", "write", 760, 200, pitch="backup monitoring that pages you before "
                                                  "the client calls"),
            _n("send", "send", 1000, 200),
            _n("wait", "wait", 1240, 200, days=3, business_hours=True),
            _n("phone", "filter", 1480, 200, conditions=[
                {"field": "has_phone", "op": "is_true", "value": ""}]),
            _n("call", "create_task", 1720, 120, title="Call {{first_name}} at {{company}}",
               kind="call", due="today"),
            _n("li", "create_task", 1720, 300, title="Message {{first_name}} on LinkedIn",
               kind="linkedin", due="today"),
        ],
        "edges": [_e("trigger", "find"), _e("find", "dedupe"), _e("dedupe", "write"),
                  _e("write", "send"), _e("send", "wait"), _e("wait", "phone"),
                  _e("phone", "call", "true"), _e("phone", "li", "false")],
    },
]


def list_templates() -> list:
    return [{"key": t["key"], "title": t["title"], "description": t["description"],
             "nodes": len(t["nodes"])} for t in TEMPLATES]


def get(key: str) -> dict | None:
    for t in TEMPLATES:
        if t["key"] == key:
            return copy.deepcopy(t)
    return None


def instantiate(key: str, name: str | None = None) -> dict:
    """A new, paused, not-live graph from a template."""
    t = get(key)
    if not t:
        raise ValueError(f"no template '{key}' (see `openleads workflow templates`)")
    return {"name": name or t["key"], "description": t["description"], "active": False,
            "live": False, "nodes": t["nodes"], "edges": t["edges"]}
