"""
MCP server — let Claude, Cursor, and other AI tools find and verify leads.

Speaks the Model Context Protocol over stdio (newline-delimited JSON-RPC 2.0), with
no dependencies. Add it to any MCP client:

    {"mcpServers": {"openleads": {"command": "openleads", "args": ["mcp"]}}}

Tools:

* ``find_leads``   — "dentists in Austin" → people + verified emails
* ``find_email``   — a name + company domain → the most likely address, with evidence
* ``verify_email`` — check one address: safe / risky / bad, and why
* ``list_sources`` — what OpenLeads can search

stdout carries only protocol messages; anything else goes to stderr.
"""
from __future__ import annotations

import json
import sys
import traceback

from openleads import __version__

PROTOCOL_VERSIONS = ("2025-06-18", "2025-03-26", "2024-11-05")

TOOLS = [
    {
        "name": "find_leads",
        "description": (
            "Find B2B leads from free public sources and verify their emails. Describe "
            "who you want in plain English, e.g. 'dentists in Austin', 'marketing "
            "agencies in Miami', 'fintech founders', 'rust developers in Berlin', or "
            "'emails at stripe.com'. Returns people/companies with an email, a "
            "deliverability tier (safe/risky), and evidence (found/pattern/guessed)."),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Who to find, in plain English."},
                "count": {"type": "integer", "minimum": 1, "maximum": 100, "default": 10},
                "verified_only": {"type": "boolean", "default": False,
                                  "description": "Only return deliverable (safe-tier) emails."},
                "budget_seconds": {"type": "integer", "minimum": 10, "maximum": 300,
                                   "default": 90},
            },
            "required": ["query"],
        },
    },
    {
        "name": "find_email",
        "description": "Find the most likely work email for a person at a company domain.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Full name, e.g. 'Ada Lovelace'."},
                "domain": {"type": "string", "description": "Company domain, e.g. 'acme.com'."},
            },
            "required": ["name", "domain"],
        },
    },
    {
        "name": "verify_email",
        "description": "Check whether an email address is deliverable (safe/risky/bad) and why.",
        "inputSchema": {
            "type": "object",
            "properties": {"email": {"type": "string"}},
            "required": ["email"],
        },
    },
    {
        "name": "list_sources",
        "description": "List the public data sources OpenLeads can search.",
        "inputSchema": {"type": "object", "properties": {}},
    },
]


def _lead_dict(ld) -> dict:
    d = ld.to_dict()
    d.pop("signals", None)
    d.pop("score", None)
    return {k: v for k, v in d.items() if v not in ("", None, [])}


def _email_dict(r, checking: bool = False) -> dict:
    from openleads.models import evidence_of
    ev = evidence_of(r.email, r.signals)
    if checking and ev == "guessed":
        ev = "unconfirmed"          # the caller supplied it; we just couldn't confirm it
    return {"email": r.email, "tier": r.tier, "confidence_pct": r.confidence_pct,
            "evidence": ev, "reasons": r.reasons}


def call_tool(name: str, args: dict) -> dict:
    """Run one tool and return a JSON-ready result (raises on bad input)."""
    from openleads.cache.store import Cache
    from openleads.db import DB
    args = args or {}
    if name == "list_sources":
        from openleads.sources import list_sources
        return {"sources": [{"name": s.name, "kind": s.kind, "vertical": s.vertical,
                             "description": s.description} for s in list_sources()]}
    cache, db = Cache(), DB()
    try:
        if name == "find_leads":
            from openleads.engine import build_leads
            from openleads.intent import rule_parse
            text = str(args.get("query") or "").strip()
            if not text:
                raise ValueError("query is required")
            q = rule_parse(text)
            q.count = max(1, min(int(args.get("count") or 10), 100))
            q.verified_only = bool(args.get("verified_only", False))
            q.budget = max(10, min(int(args.get("budget_seconds") or 90), 300))
            leads = build_leads(q, cache=cache, db=db)
            return {"query": text, "count": len(leads), "leads": [_lead_dict(x) for x in leads]}
        if name == "find_email":
            from openleads.emails.resolve import find_email
            nm, dom = str(args.get("name") or ""), str(args.get("domain") or "")
            if not nm or not dom:
                raise ValueError("name and domain are required")
            return _email_dict(find_email(nm, dom, cache=cache, db=db))
        if name == "verify_email":
            from openleads.emails.resolve import verify_address
            return _email_dict(verify_address(str(args.get("email") or ""), cache=cache, db=db),
                               checking=True)
        raise ValueError(f"unknown tool: {name}")
    finally:
        cache.close()
        db.close()


def handle(msg: dict) -> dict | None:
    """Handle one JSON-RPC message; return the response (None for notifications)."""
    method = msg.get("method")
    mid = msg.get("id")
    if mid is None:                       # notifications (initialized, cancelled, …)
        return None

    def ok(result):
        return {"jsonrpc": "2.0", "id": mid, "result": result}

    def err(code, message):
        return {"jsonrpc": "2.0", "id": mid, "error": {"code": code, "message": message}}

    params = msg.get("params") or {}
    if method == "initialize":
        asked = params.get("protocolVersion")
        version = asked if asked in PROTOCOL_VERSIONS else PROTOCOL_VERSIONS[0]
        return ok({
            "protocolVersion": version,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": "openleads", "version": __version__},
            "instructions": ("Use find_leads with a plain-English description of the "
                             "people or businesses wanted. Emails marked evidence="
                             "'guessed' are unconfirmed; prefer tier 'safe' for sending."),
        })
    if method == "ping":
        return ok({})
    if method == "tools/list":
        return ok({"tools": TOOLS})
    if method == "tools/call":
        name = params.get("name", "")
        try:
            result = call_tool(name, params.get("arguments") or {})
        except Exception as e:  # noqa: BLE001 — tool errors go back to the model
            traceback.print_exc(file=sys.stderr)
            return ok({"content": [{"type": "text", "text": f"Error: {e}"}], "isError": True})
        return ok({"content": [{"type": "text", "text": json.dumps(result, indent=2)}],
                   "structuredContent": result, "isError": False})
    return err(-32601, f"method not found: {method}")


def serve(stdin=None, stdout=None) -> int:
    """Run the stdio loop until stdin closes."""
    stdin = stdin or sys.stdin
    stdout = stdout or sys.stdout
    # Anything a library prints must not corrupt the protocol stream.
    real_stdout, sys.stdout = sys.stdout, sys.stderr
    try:
        return _loop(stdin, stdout)
    finally:
        sys.stdout = real_stdout


def _loop(stdin, stdout) -> int:
    for line in stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            resp = {"jsonrpc": "2.0", "id": None,
                    "error": {"code": -32700, "message": "parse error"}}
        else:
            resp = handle(msg) if isinstance(msg, dict) else {
                "jsonrpc": "2.0", "id": None,
                "error": {"code": -32600, "message": "batches are not supported"}}
        if resp is not None:
            stdout.write(json.dumps(resp) + "\n")
            stdout.flush()
    return 0
