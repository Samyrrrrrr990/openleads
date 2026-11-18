"""
A sentence in, a workflow graph out: the editor's "Describe it" box.

    "every weekday find 20 dentists in Toronto, write emails, send them
     and add them to list Dentists"

becomes Schedule → Find → Only safe → Skip contacted → Write → Send → Add to list,
laid out left to right on the canvas, unsaved, for you to look at and change.

It is a reader, not a model: it recognises a trigger ("every weekday at 9",
"when someone replies", "when new leads come in"), where the people come from
("find 20 …", "people in list X", "people tagged X") and the steps you name, in the
order you name them. Anything it can't place it leaves out rather than guessing.
When it finds nothing past the trigger, the Ask planner (which can use your model)
gets a turn.
"""
from __future__ import annotations

import re

from openleads.automate.workflow import graph as graphmod

X0, DX, Y = 40, 240, 200

_DAYS = r"(?:weekday|weekdays|day|monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|morning)"
_SCHEDULE_RE = re.compile(
    rf"\b(?:every|each)\s+(?P<when>{_DAYS}s?|\d+\s*(?:h|hours?|m|min|minutes?))"
    r"(?:\s+(?:at\s+)?(?P<time>\d{1,2}(?::\d\d)?\s*(?:am|pm)?))?", re.I)
_DAILY_RE = re.compile(r"\b(daily|hourly|weekly)\b(?:\s+at\s+(?P<time>\d{1,2}(?::\d\d)?\s*(?:am|pm)?))?", re.I)
_REPLY_RE = re.compile(r"\b(?:when|whenever|if)\s+(?:someone|anyone|a lead|a contact|they|people)?\s*repl", re.I)
_NEW_RE = re.compile(r"\b(?:when|whenever)\s+(?:there (?:are|is)\s+)?new\s+(?:leads?|contacts?|people)", re.I)
_FIND_RE = re.compile(
    r"\b(?:find|get|search for|look for|prospect)\s+(?:me\s+)?(?:(?P<n>\d{1,4})\s+)?(?P<who>.+?)"
    r"(?=,|;|:|\.(?:\s|$)|\band then\b|\bthen\b|\band (?:write|email|send|draft|verify|add|tag|enroll|"
    r"start|put|move|set|create|export|notify|ping|skip|only|limit)\b|$)", re.I)
_LIST_SRC_RE = re.compile(r"\b(?:people|contacts|leads|everyone)\s+(?:in|on|from)\s+(?:my\s+)?(?:the\s+)?list\s+[\"']?(?P<name>[\w .&-]+?)[\"']?(?=,|;|:|\.|\band\b|\bthen\b|\bas\b|\bwith\b|$)", re.I)
_TAG_SRC_RE = re.compile(r"\b(?:people|contacts|leads|everyone)\s+tagged\s+[\"']?(?P<tag>[\w-]+)", re.I)

_STEP_RES = [
    ("verify", re.compile(r"\bverif(?:y|ied)\b(?!\s+(?:leads|ones)\s+only)", re.I)),
    ("split_tier", re.compile(r"\b(?:only\s+(?:the\s+)?(?:safe|verified|deliverable)|(?:safe|verified|deliverable)\s+(?:ones|leads|emails)?\s*only)\b", re.I)),
    ("dedupe", re.compile(r"\b(?:skip|dedupe|de-dupe|no duplicates|not already|haven't|have not)\b", re.I)),
    ("limit", re.compile(r"\b(?:at most|max(?:imum)?|limit(?: to)?|top)\s+(?P<n>\d{1,4})\b", re.I)),
    ("write", re.compile(r"\b(?:write|draft|compose)\b|\bemail(?:s)?\s+(?:them|each|everyone)\b|\breach out\b", re.I)),
    ("wait", re.compile(r"\bwait\s+(?P<n>\d{1,3})\s*(?P<unit>days?|hours?)\b", re.I)),
    ("send", re.compile(r"\bsend\b|\bemail(?:s)?\s+(?:them|each|everyone)\b|\breach out\b", re.I)),
    ("add_to_list", re.compile(r"\b(?:add|put|save)\s+(?:them\s+|everyone\s+|each\s+)?(?:to|in|into|on)\s+(?:my\s+|the\s+|a\s+)?list\s+[\"']?(?P<name>[\w .&-]+?)[\"']?(?=,|;|\.|\band\b|\bthen\b|$)", re.I)),
    ("enroll", re.compile(r"\b(?:enrol(?:l)?|start|put)\s+(?:them\s+)?(?:in|on|into)?\s*(?:the\s+)?(?:sequence\s+[\"']?(?P<name>[\w .&-]+?)[\"']?|(?P<name2>[\w .&-]+?)\s+sequence)(?=,|;|\.|\band\b|\bthen\b|$)", re.I)),
    ("tag", re.compile(r"\btag\s+(?:them\s+|each\s+)?(?:as\s+|with\s+)?[\"']?(?P<tags>[\w-]+)", re.I)),
    ("set_stage", re.compile(r"\b(?:move|set)\s+(?:them\s+|the\s+stage\s+)?(?:to|as)\s+(?P<stage>[\w ]+?)(?:\s+stage)?(?=\s*(?:,|;|:|\.|\band\b|\bthen\b|$))", re.I)),
    ("create_task", re.compile(r"\b(?:create|make|add)\s+(?:a\s+)?(?:follow[- ]up\s+)?(?:task|to-?do|reminder)|\bremind me\b", re.I)),
    ("export", re.compile(r"\bexport\b(?:\s+(?:them\s+)?to\s+(?P<sink>csv|json|sheets?|google sheets|notion|webhook))?", re.I)),
    ("notify", re.compile(r"\b(?:notify|ping|alert|tell)\s+me\b|\bslack\b|\bdiscord\b", re.I)),
]


def _time24(text: str) -> str:
    m = re.match(r"(\d{1,2})(?::(\d\d))?\s*(am|pm)?", (text or "").strip(), re.I)
    if not m:
        return "09:00"
    h, mi, ap = int(m.group(1)), int(m.group(2) or 0), (m.group(3) or "").lower()
    if ap == "pm" and h < 12:
        h += 12
    if ap == "am" and h == 12:
        h = 0
    return f"{h % 24:02d}:{mi:02d}"


def _trigger(text: str):
    if _REPLY_RE.search(text):
        return {"type": "trigger.reply", "params": {}}, "when someone replies"
    m = _NEW_RE.search(text)
    if m:
        return {"type": "trigger.new_leads", "params": {}}, "when new leads come in"
    m = _SCHEDULE_RE.search(text)
    if m:
        when = m.group("when").lower().rstrip("s")
        t = _time24(m.group("time") or "9am")
        if re.match(r"\d", when):
            n = re.match(r"(\d+)\s*(\w)", when)
            spec = f"every {n.group(1)}{'h' if n.group(2) == 'h' else 'm'}"
        elif when in ("day", "morning"):
            spec = f"daily {t}"
        elif when == "weekday":
            spec = f"weekdays {t}"
        elif when == "week":
            spec = f"mondays {t}"
        else:
            spec = f"{when}s {t}"
        return {"type": "trigger.schedule", "params": {"schedule": spec}}, spec
    m = _DAILY_RE.search(text)
    if m:
        word = m.group(1).lower()
        t = _time24(m.group("time") or "9am")
        spec = {"daily": f"daily {t}", "hourly": "hourly", "weekly": f"mondays {t}"}[word]
        return {"type": "trigger.schedule", "params": {"schedule": spec}}, spec
    return {"type": "trigger.manual", "params": {}}, "when you press Run"


def _stage(said: str) -> str:
    """A contact stage key from what was said: "meeting booked" -> meeting."""
    from openleads.workspace.stages import CONTACT_STAGES
    said = " ".join((said or "").lower().replace("_", " ").replace("-", " ").split())
    for key, label, _ in CONTACT_STAGES:
        if said in (key.replace("_", " "), label.lower()):
            return key
    for key, label, _ in CONTACT_STAGES:
        if said.startswith(key.replace("_", " ")) or label.lower().startswith(said):
            return key
    return said.replace(" ", "_")


def _clean_who(who: str) -> str:
    who = re.sub(_SCHEDULE_RE, "", who)
    who = re.sub(r"\b(?:daily|hourly|weekly)\b.*$", "", who, flags=re.I)
    return " ".join(who.split()).strip(" ,.;")


def draft(text: str) -> dict:
    """``{"workflow": graph, "understood": [...], "skipped": "..."}`` for a sentence."""
    text = " ".join((text or "").split())
    if not text:
        raise ValueError("describe what the workflow should do")
    nodes, understood = [], []
    trig, said = _trigger(text)
    nodes.append(trig)
    understood.append(f"Runs {said}")

    # Where the people come from.
    body = text
    m_list = _LIST_SRC_RE.search(body)
    m_tag = _TAG_SRC_RE.search(body)
    m_find = _FIND_RE.search(body)
    if m_find and trig["type"] != "trigger.reply":
        who = _clean_who(m_find.group("who"))
        n = int(m_find.group("n") or 20)
        if who:
            nodes.append({"type": "find", "params": {"query": who, "count": max(1, min(1000, n))}})
            understood.append(f"Finds {n} {who}")
    elif m_list:
        nodes.append({"type": "contacts", "params": {"list": m_list.group("name").strip()}})
        understood.append(f"Takes the people in list {m_list.group('name').strip()}")
    elif m_tag:
        nodes.append({"type": "contacts", "params": {"tag": m_tag.group("tag")}})
        understood.append(f"Takes the people tagged {m_tag.group('tag')}")

    # The steps, in the order they're mentioned. Text consumed by the source match
    # is ignored, so "find people to email" doesn't also read as "send".
    rest = body
    for m in (m_find, m_list, m_tag):
        if m:
            rest = rest.replace(m.group(0), " " * len(m.group(0)))
    hits = []
    for kind, rx in _STEP_RES:
        for m in rx.finditer(rest):
            hits.append((m.start(), kind, m))
            break
    hits.sort(key=lambda h: h[0])
    kinds = [k for _, k, _ in hits]
    if "send" in kinds and "write" not in kinds:
        hits.insert(kinds.index("send"), (-1, "write", None))
    if "send" in kinds and "dedupe" not in kinds:
        hits.insert(0, (-2, "dedupe", None))
    if any(k in kinds for k in ("send", "write")) and "split_tier" not in kinds and nodes[-1]["type"] == "find":
        hits.insert(0, (-3, "split_tier", None))
    hits.sort(key=lambda h: h[0])
    seen = set()
    for _, kind, m in hits:
        if kind in seen:
            continue
        seen.add(kind)
        params: dict = {}
        if kind == "limit" and m:
            params = {"max": int(m.group("n"))}
        elif kind == "wait" and m:
            unit = m.group("unit").lower()
            params = {"days": int(m.group("n"))} if unit.startswith("day") else {"days": 0, "hours": int(m.group("n"))}
        elif kind == "add_to_list" and m:
            params = {"list": m.group("name").strip()}
        elif kind == "enroll" and m:
            params = {"sequence": (m.group("name") or m.group("name2") or "").strip()}
        elif kind == "tag" and m:
            params = {"tags": m.group("tags")}
        elif kind == "set_stage" and m:
            params = {"stage": _stage(m.group("stage"))}
        elif kind == "export" and m and m.group("sink"):
            sink = m.group("sink").lower()
            params = {"sink": "sheets" if "sheet" in sink else sink}
        nodes.append({"type": kind, "params": params})
    labels = {"verify": "verifies every address", "split_tier": "keeps only safe addresses",
              "dedupe": "skips people you already contacted", "limit": "caps how many go on",
              "write": "writes an email to each", "wait": "waits", "send": "sends (waiting for your approval unless the workflow is live)",
              "add_to_list": "adds them to a list", "enroll": "starts a sequence", "tag": "tags them",
              "set_stage": "moves their stage", "create_task": "creates a task",
              "export": "exports them", "notify": "notifies you"}
    understood += [labels[n["type"]][:1].upper() + labels[n["type"]][1:] for n in nodes[1:]
                   if n["type"] in labels]

    # Lay out and wire: a straight line, through each splitter's "keep" port.
    graph_nodes, edges = [], []
    for i, n in enumerate(nodes):
        nid = f"n{i + 1}"
        graph_nodes.append({"id": nid, "type": n["type"], "params": n["params"],
                            "position": {"x": X0 + DX * i, "y": Y}})
        if i:
            prev = graph_nodes[i - 1]
            port = {"split_tier": "safe", "filter": "true"}.get(prev["type"], "out")
            edges.append({"from": prev["id"], "from_port": port, "to": nid})
    name = re.sub(r"[^\w-]+", "-", (nodes[1]["params"].get("query") if len(nodes) > 1 and
                                    nodes[1]["type"] == "find" else text)[:40].lower()).strip("-") or "workflow"
    g = graphmod.normalize({"name": name, "description": text[:500], "nodes": graph_nodes,
                            "edges": edges})
    skipped = "" if len(nodes) > 1 else "I only found when it runs. Add the steps from the panel on the left."
    return {"workflow": g, "understood": understood, "skipped": skipped}


def from_sentence(text: str, use_model: bool = True) -> dict:
    """This reader first; Ask's planner (which may use your model) only when the reader
    found nothing past the trigger."""
    mine = draft(text)
    if len(mine["workflow"]["nodes"]) > 1:
        return mine
    try:
        from openleads import ask
        plan = ask.make_plan(text, live=False, sequence_names=[], use_model=use_model)
        if plan.kind == "workflow" and plan.graph:
            return {"workflow": graphmod.normalize(plan.graph),
                    "understood": [str(s) for s in plan.steps], "skipped": ""}
    except Exception:  # noqa: BLE001 — the reader's answer stands
        pass
    return mine
