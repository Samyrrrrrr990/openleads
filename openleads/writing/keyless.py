"""
The keyless writer: short, natural cold emails assembled from the phrase library.

Choices are deterministic per lead (a hash of the email, step, variant and slot), so
re-running a campaign reproduces the same drafts while two people at the same company
still get different copy. Each email records *why* every line was chosen.
"""
from __future__ import annotations

import hashlib
import re

from openleads.writing import library as L
from openleads.writing.brief import TOPIC_TECH, Brief


def _h(*parts) -> int:
    return int(hashlib.sha1("|".join(str(p) for p in parts).encode("utf-8")).hexdigest()[:12], 16)


class Picker:
    """Deterministic choice: same lead + step + variant + slot → same option."""

    def __init__(self, seed: str, step: int = 1, variant: int = 0) -> None:
        self.seed, self.step, self.variant = seed, step, variant

    def pick(self, slot: str, options):
        options = list(options)
        if not options:
            return None
        return options[_h(self.seed, self.step, self.variant, slot) % len(options)]


def _join(items: list) -> str:
    items = [i for i in items if i]
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]


def _sentence(text: str) -> str:
    text = " ".join((text or "").split()).strip()
    if not text:
        return ""
    text = text[0].upper() + text[1:]
    return text if text[-1] in ".!?\"'" else text + "."


def pitch_lines(pitch: str, max_words: int = 40) -> str:
    """The sender's pitch, trimmed to its first sentence or two."""
    pitch = " ".join((pitch or "").split())
    if not pitch:
        return ""
    sents = re.split(r"(?<=[.!?])\s+", pitch)
    out, n = [], 0
    for s in sents:
        w = len(s.split())
        if out and n + w > max_words:
            break
        out.append(s)
        n += w
    return _sentence(" ".join(out))


def audience(b: Brief) -> str:
    leader, other, _ = L.AUDIENCE.get(b.vertical, L.AUDIENCE["general"])
    if b.role == "leader":
        return leader
    if b.role == "ops" and b.vertical in L.OPS_AUDIENCE:
        return L.OPS_AUDIENCE[b.vertical]
    if b.role in L.ROLE_AUDIENCE and not b.local_business:
        return L.ROLE_AUDIENCE[b.role]
    return other


def values(b: Brief) -> dict:
    """Template values from the brief. Only what the brief holds."""
    hiring = b.signal("hiring") or {}
    yc = b.signal("yc") or {}
    gh = b.signal("github") or {}
    paper = b.signal("paper") or {}
    techs = [t for t, _ in b.tech_highlights]
    topic_cats = TOPIC_TECH.get(b.topic, ())
    tech_topic = next((t for t, c in b.tech_highlights if c in topic_cats), "")
    pitch_low = f"{b.sender.get('pitch', '')} {b.sender.get('offer', '')}".lower()
    overlap = [t for t in b.technologies if len(t) > 2 and re.search(
        r"(?<![a-z0-9])" + re.escape(t.lower()) + r"(?![a-z0-9])", pitch_low)]
    who = audience(b)
    pains = L.PAINS.get(b.topic, ())
    repo = gh.get("text", "")
    offer = (b.sender.get("offer") or "").strip().rstrip(".?!")
    if offer and offer[:1].isupper() and not offer.split(" ")[0].isupper():
        offer = offer[0].lower() + offer[1:]
    return {
        "first": b.first_name, "company": b.company or "your team",
        "topic_object": b.topic_object, "topic_short": b.topic_short,
        "Topic_short": b.topic_short[:1].upper() + b.topic_short[1:],
        "who": who, "vertical_noun": L.AUDIENCE.get(b.vertical, L.AUDIENCE["general"])[2],
        "hiring_detail": f" for a {hiring['detail']}" if hiring.get("detail") else "",
        "hiring_source": hiring.get("source", ""),
        "batch_detail": f" ({yc['detail']})" if yc.get("detail") else "",
        "repo": repo, "repo_real": repo if repo and repo != "your profile" else "",
        "paper": paper.get("text", ""), "title": b.title,
        "bio": re.split(r"\s*[|•·]\s*", b.bio)[0][:80].rstrip(" .,") if b.bio else "",
        "desc": (b.description or "").rstrip("."),
        "tech_list": _join(techs[:2]), "tech_topic": tech_topic,
        "tech_overlap": overlap[0] if overlap else "",
        "employees": b.employees if b.employees.isdigit() else "",
        "city": b.city, "sender_org": b.sender.get("org", ""),
        "sender_name": b.sender.get("name", ""), "offer": offer,
        "proof": _sentence(b.sender.get("proof", "")),
        "pain1": pains[0].format(who=who) if len(pains) > 0 else "",
        "pain2": pains[1].format(who=who) if len(pains) > 1 else "",
        "pitch": pitch_lines(b.sender.get("pitch", "")),
    }


def _have(req: str, b: Brief, v: dict) -> bool:
    if req.startswith("signal."):
        return b.signal(req.split(".", 1)[1]) is not None
    if req.startswith(("person.", "company.")):
        return b.has(req)
    if req == "leader":
        return b.role == "leader"
    if req == "company":
        return bool(b.company)
    if req == "topic":
        return bool(b.topic)
    if req == "first":
        return bool(b.first_name) and "{{" not in b.first_name
    if req == "tech2":
        return len(b.tech_highlights) >= 2
    if req == "repo_short":
        return 0 < len(v.get("repo", "")) <= 40
    return bool(v.get(req))


def eligible(options, b: Brief, v: dict) -> list:
    return [o for o in options if all(_have(r, b, v) for r in o[1])]


def best(options, b: Brief, v: dict) -> list:
    """Eligible options that use the most specific facts (a repo beats a company name)."""
    ok = eligible(options, b, v)
    if not ok:
        return []
    weight = {f.key: f.weight for f in b.facts}
    score = lambda o: sum(weight.get(f, 0) for f in facts_of(o[1]))  # noqa: E731
    top = max(score(o) for o in ok)
    return [o for o in ok if score(o) == top]


# Which brief facts a requirement corresponds to (for the explanation + scoring).
_REQ_FACT = {"signal.hiring": "signal.hiring", "signal.yc": "signal.yc",
             "signal.hn_post": "signal.hn_post", "signal.github": "signal.github",
             "signal.paper": "signal.paper", "signal.producthunt": "signal.producthunt",
             "company.description": "company.description", "tech2": "company.tech",
             "tech_topic": "company.tech", "tech_overlap": "company.tech",
             "employees": "company.size", "company": "company.name",
             "person.title": "person.title", "person.bio": "person.bio"}


def facts_of(req) -> list:
    return [_REQ_FACT[r] for r in req if r in _REQ_FACT]


def eligible_angles(b: Brief) -> list:
    v = values(b)
    out = [a for a in L.ANGLES if a == "short-ask" or eligible(L.OPENERS[a], b, v)]
    return out


def auto_angle(b: Brief) -> tuple:
    """``(angle, why)`` chosen from what the brief holds."""
    if b.kind == "company":
        return "inbox", "a shared inbox, so ask who the right person is"
    angles = eligible_angles(b)
    p = Picker(b.seed)
    if "mutual-signal" in angles:
        return "mutual-signal", "there's a real signal to lead with"
    if "compliment" in angles:
        pick = p.pick("angle", [a for a in ("compliment", "curiosity") if a in angles])
        return pick, "we know something specific about the company"
    if "pain" in angles or "curiosity" in angles:
        pick = p.pick("angle", [a for a in ("pain", "curiosity") if a in angles])
        return pick, "your pitch has a clear topic to ask about"
    return "short-ask", "little is known, so keep it to two lines"


class Email:
    """An assembled email plus how it was assembled."""

    def __init__(self) -> None:
        self.subject = ""
        self.subject_options: list = []
        self.lines: list = []          # paragraphs between greeting and sign-off
        self.greeting = ""
        self.signoff = ""
        self.angle = ""
        self.explain: list = []
        self.facts_used: list = []

    @property
    def body(self) -> str:
        parts = [self.greeting] + [p for p in self.lines if p] + [self.signoff]
        return "\n\n".join(p for p in parts if p).strip()

    def note(self, slot: str, text: str, why: str, facts=()) -> None:
        self.explain.append({"slot": slot, "text": text, "why": why})
        for f in facts:
            if f not in self.facts_used:
                self.facts_used.append(f)


def _fmt(tmpl: str, v: dict) -> str:
    return " ".join(tmpl.format(**v).split())


def _greeting(b: Brief, tone: str, e: Email) -> None:
    word = L.GREETINGS.get(tone, "Hi")
    if b.first_name:
        e.greeting = f"{word} {b.first_name},"
        e.note("greeting", e.greeting, "their first name", ["person.first_name"])
    elif b.kind == "company" and b.company:
        e.greeting = f"{word} {b.company} team,"
        e.note("greeting", e.greeting, "a shared inbox, so greet the team, not a person")
    else:
        e.greeting = f"{word} there,"
        e.note("greeting", e.greeting, "no usable first name")


def _signoff(b: Brief, tone: str, p: Picker, e: Email) -> None:
    word = p.pick("signoff", L.SIGNOFFS.get(tone, L.SIGNOFFS["plain"]))
    name, org = b.sender.get("name", ""), b.sender.get("org", "")
    lines = [word] + ([name] if name else []) + ([org] if name and org else [])
    e.signoff = "\n".join(lines)
    e.note("sign-off", e.signoff.replace("\n", " "), f"tone: {tone}"
           + ("" if name else "; set your name in Settings to sign off properly"))


def _subject(b: Brief, angle: str, v: dict, p: Picker, e: Email, variant: int) -> None:
    pool = eligible(L.SUBJECTS.get(angle, ()), b, v) or eligible(L.SUBJECTS["fallback"], b, v)
    choice = p.pick("subject", pool)
    casual, plain = _fmt(choice[2], v), _fmt(choice[3], v)
    e.subject_options = [casual, plain] if casual != plain else [casual]
    e.subject = plain if (variant % 2 == 1 and b.sender.get("tone") != "casual") else casual
    e.note("subject", e.subject, "lowercase-casual" if e.subject == casual else "plain case",
           facts_of(choice[1]))


def _value(b: Brief, v: dict, e: Email) -> None:
    if v["pitch"]:
        e.lines.append(v["pitch"])
        e.note("value", v["pitch"], "your pitch, from Settings")
    elif b.sender.get("org"):
        line = (f"I'm {b.sender['name']} from {b.sender['org']}." if b.sender.get("name")
                else f"I work on {b.sender['org']}.")
        e.lines.append(line)
        e.note("value", line, "no pitch set, so just say who you are")
    else:
        line = f"I had an idea that might be useful for {v['company']}."
        e.lines.append(line)
        e.note("value", line, "no pitch or company set in Settings")


def _cta(b: Brief, angle: str, tone: str, v: dict, p: Picker, e: Email) -> str:
    if angle == "inbox":
        pool, why = L.INBOX_CTAS, "a shared inbox: ask to be pointed to the right person"
    elif angle == "short-ask":
        pool, why = L.SHORT_ASK_CTAS, "short ask: a yes/no question"
    elif v["offer"]:
        pool, why = L.OFFER_CTAS.get(tone, L.OFFER_CTAS["plain"]), "your offer, from Settings"
    else:
        pool, why = L.CTAS.get(tone, L.CTAS["plain"]), f"tone: {tone}"
    line = _fmt(p.pick("cta", pool), v)
    e.note("ask", line, why)
    return line


def first_email(b: Brief, angle: str | None = None, tone: str = "plain", variant: int = 0) -> Email:
    """Step 1: opener + value + (proof) + one ask."""
    e = Email()
    p = Picker(b.seed, 1, variant)
    v = values(b)
    tone = tone if tone in L.TONES else "plain"
    why_angle = "you asked for it"
    if b.kind == "company":
        angle, why_angle = "inbox", "a shared inbox, so ask who the right person is"
    elif not angle or angle == "auto":
        angle, why_angle = auto_angle(b)
    elif angle not in eligible_angles(b):
        wanted = angle
        angle, why_angle = auto_angle(b)
        why_angle = f"'{wanted}' needs facts this lead doesn't have; {why_angle}"
    e.angle = angle
    e.note("angle", angle, why_angle)
    _greeting(b, tone, e)
    opener = None
    if angle != "short-ask":
        opener = p.pick("opener", best(L.OPENERS.get(angle, ()), b, v))
    elif b.title:
        role = p.pick("role", [r for r in eligible(L.ROLE_LINES, b, v) if r[0] != "role-know"])
        if role:
            line = _fmt(role[2], v)
            e.lines.append(line)
            e.note("why you", line, role[3], facts_of(role[1]))
    if opener:
        text = _fmt(opener[2], v)
        e.note("opener", text, _fmt(opener[3], v), facts_of(opener[1]))
        role = None
        if angle != "inbox" and "person.title" not in opener[1]:
            role = p.pick("role", eligible(L.ROLE_LINES, b, v))
        if role:
            line = _fmt(role[2], v)
            text = f"{text} {line}"
            e.note("why you", line, role[3], facts_of(role[1]))
        e.lines.append(text)
    _value(b, v, e)
    if v["proof"] and angle not in ("short-ask", "inbox"):
        e.lines[-1] = f"{e.lines[-1]} {v['proof']}"
        e.note("proof", v["proof"], "your proof line, from Settings")
    cta = _cta(b, angle, tone, v, p, e)
    if tone == "warm" and angle != "inbox" and "schedule" not in cta:
        cta = f"{cta} {p.pick('soft', L.SOFT_LINES)}"
    e.lines.append(cta)
    _signoff(b, tone, p, e)
    _subject(b, angle, v, p, e, variant)
    return e


def follow_up(b: Brief, step: int, first: Email, tone: str = "plain", variant: int = 0,
              final: bool = False, thread_subject: str = "") -> Email:
    """Step 2+: same thread, new information, never the first email again."""
    e = Email()
    p = Picker(b.seed, step, variant)
    v = values(b)
    tone = tone if tone in L.TONES else "plain"
    base = thread_subject or first.subject or L.FOLLOWUP_SUBJECT_FALLBACK
    while base.lower().startswith("re:"):
        base = base[3:].strip()
    e.subject = f"re: {base}"
    e.subject_options = [e.subject]
    e.note("subject", e.subject, "same thread as the first email")
    _greeting(b, tone, e)
    used = " ".join(first.lines).lower()
    if final:
        e.angle = "breakup"
        pool = L.BREAKUPS if b.topic and b.company else L.BREAKUPS_NO_TOPIC
        text = _fmt(p.pick("breakup", pool), v)
        e.lines.append(text)
        e.note("breakup", text, "last step: close the loop politely")
    elif b.kind == "company":
        e.angle = "inbox"
        pool = L.INBOX_FOLLOWUPS if (b.topic and b.company) else L.INBOX_FOLLOWUPS_PLAIN
        start = _h(b.seed, "inbox-fu") % len(pool)
        text = _fmt(pool[(start + step - 2) % len(pool)], v)
        e.lines.append(text)
        e.note("follow-up", text, "a shared inbox: ask again for the right person")
    elif step == 2:
        e.angle = "follow-up"
        opener = p.pick("fu-open", L.FOLLOWUP_OPENERS)
        adds = [a for a in eligible(L.FOLLOWUP_ADDS, b, v)
                if _fmt(a[2], v).lower()[:40] not in used
                and not (a[0] == "question" and first.angle == "curiosity")]
        add = adds[0] if adds else L.FOLLOWUP_ADDS[-1]
        add_text = _fmt(add[2], v)
        e.lines.append(f"{opener} {add_text}")
        e.note("follow-up", opener, "a short nudge that refers to the first email")
        e.note("new info", add_text, {"proof": "your proof line wasn't in the first email",
                                      "question": "a question the first email didn't ask",
                                      "pain": "a different problem than the first email",
                                      "overview": "a lighter ask than a call"}[add[0]],
               facts_of(add[1]))
        first_cta = next((x["text"] for x in first.explain if x["slot"] == "ask"), "")
        cta = p.pick("fu-cta", [c for c in L.FOLLOWUP_CTAS if c != first_cta])
        e.lines.append(cta)
        e.note("ask", cta, "a different ask than the first email")
    else:
        e.angle = "nudge"
        pool = L.NUDGES if (b.topic and b.company) else L.NUDGES_NO_TOPIC
        text = _fmt(pool[(_h(b.seed, "nudge") + step - 3) % len(pool)], v)
        e.lines.append(text)
        e.note("nudge", text, "a yes/no question that's easy to answer")
    _signoff(b, tone, p, e)
    return e
