"""
The quality gate every draft passes through: a 0–100 score with plain reasons.

It folds together the deliverability lint (:func:`openleads.outreach.compose.spam_lint`)
and the things that make cold email read like a person wrote it: length, reading
level, how many facts about the lead it actually uses, links and attachments,
unresolved ``{{variables}}``, a greeting that is really a company name, fake
familiarity ("as we discussed"), and — for follow-ups — repeating the first email.

:func:`facts_check` is the "no invented facts" guard used on LLM output: it lists
specifics in a draft (numbers, names, tools, places) that the brief doesn't contain.
"""
from __future__ import annotations

import re

from openleads.writing import library as L

_VAR_RE = re.compile(r"\{\{\s*[^}]*\}\}")
_BRACKET_RE = re.compile(r"\[[^\]\n]{1,40}\]|\{[^{}\n]{1,40}\}")
_URL_RE = re.compile(r"https?://\S+|www\.\S+", re.I)
_ATTACH_RE = re.compile(r"\b(attached|attachment|enclosed|see the (?:pdf|deck|file)|"
                        r"i've attached|i have attached)\b", re.I)
# Capitalized words that aren't specifics.
_COMMON_CAPS = {
    "i", "i'm", "i'd", "i'll", "i've", "hi", "hey", "hello", "thanks", "best", "cheers",
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "january", "february", "march", "april", "may", "june", "july", "august", "september",
    "october", "november", "december", "ai", "ceo", "cto", "coo", "cfo", "cmo", "vp", "hr",
    "ps", "p.s.", "ok", "okay", "us", "q1", "q2", "q3", "q4", "faq", "b2b", "saas", "it",
    "re", "no", "yes", "sorry", "happy", "worth", "open", "would", "could", "quick", "just",
    "warmly", "regards", "kind", "all", "team",
}
_DURATION_RE = re.compile(r"\b\d{1,3}[- ]?(?:min|minute|minutes|mins|sec|second|seconds)\b", re.I)


def words(text: str) -> list:
    return re.findall(r"[A-Za-z0-9']+", text or "")


def _syllables(word: str) -> int:
    w = word.lower().strip("'")
    if not w:
        return 0
    if len(w) <= 3:
        return 1
    w = re.sub(r"(?:[^laeiouy]es|ed|[^laeiouy]e)$", "", w)
    w = re.sub(r"^y", "", w)
    return max(1, len(re.findall(r"[aeiouy]{1,2}", w)))


def reading_grade(text: str) -> float:
    """Flesch–Kincaid grade level (≈ US school grade needed to read it)."""
    body = _strip_greeting_signoff(text)
    ws = words(body)
    if not ws:
        return 0.0
    sentences = max(1, len(re.findall(r"[.!?]+(?:\s|$)", body)))
    syl = sum(_syllables(w) for w in ws)
    return round(0.39 * (len(ws) / sentences) + 11.8 * (syl / len(ws)) - 15.59, 1)


def _strip_greeting_signoff(text: str) -> str:
    paras = [p for p in re.split(r"\n\s*\n", (text or "").strip()) if p.strip()]
    if paras and re.match(r"^(hi|hey|hello|dear|good)\b", paras[0].strip(), re.I) and \
            len(paras[0].split()) <= 6:
        paras = paras[1:]
    if paras and len(paras[-1].split()) <= 6 and not paras[-1].rstrip().endswith("?"):
        paras = paras[:-1]
    return "\n\n".join(paras)


def _markers(fact) -> list:
    """Phrases whose presence shows a fact was used."""
    key, val = fact.key, fact.value
    if key == "signal.hiring":
        return ["hiring"]
    if key == "signal.yc":
        return ["y combinator", "yc"]
    if key == "signal.hn_post":
        return ["hacker news", "hn "]
    if key == "signal.github":
        return [val.split(" (")[0].lower(), "github"]
    if key in ("signal.paper", "signal.producthunt", "company.description", "person.bio"):
        content = [w for w in re.findall(r"[a-z0-9]+", val.lower()) if len(w) > 3]
        return ["~" + " ".join(content)] if content else []
    if key == "company.tech":
        return [t.strip().lower() for t in val.split(",") if t.strip()]
    if key == "company.size":
        n = re.findall(r"\d+", val)
        return [n[0]] if n else []
    if key == "company.location":
        return [val.split(",")[0].strip().lower()]
    return [val.lower()] if val else []


def facts_used(text: str, brief) -> list:
    """Keys of the brief facts a draft actually mentions."""
    if brief is None:
        return []
    low = " " + re.sub(r"\s+", " ", (text or "").lower()) + " "
    used = []
    for f in brief.facts:
        for m in _markers(f):
            if m.startswith("~"):
                content = m[1:].split()
                hits = sum(1 for w in content if w in low)
                if content and hits >= max(2, (len(content) + 1) // 2):
                    used.append(f.key)
                    break
            elif m and re.search(r"(?<![a-z0-9])" + re.escape(m.strip()) + r"(?![a-z0-9])", low):
                used.append(f.key)
                break
    return used


def facts_check(subject: str, body: str, brief) -> list:
    """Specifics in a draft the brief doesn't contain → ``["mentions '42%'", …]``.

    Checks numbers, capitalized names mid-sentence, known technology names, and
    fake-familiarity phrases. An empty list means nothing looks invented.
    """
    from openleads.insights.techstack import NAMES
    problems: list = []
    text = f"{subject}\n{body}"
    vocab = brief.vocabulary() if brief is not None else set()
    clean = _DURATION_RE.sub(" ", text)
    for num in re.findall(r"[$€£]?\d[\d,.]*%?[kKmMbB]?", clean):
        core = num.strip("$€£%,.").lower()
        if core and core not in vocab and core.rstrip("kmb") not in vocab:
            problems.append(f"mentions '{num}', which isn't in the brief")
    low = text.lower()
    for tech in NAMES:
        t = tech.lower()
        if len(t) > 2 and re.search(r"(?<![a-z0-9])" + re.escape(t) + r"(?![a-z0-9])", low):
            if not all(w in vocab for w in re.findall(r"[a-z0-9]+", t)):
                problems.append(f"mentions {tech}, which isn't in the brief")
    for line in text.split("\n"):
        for sent in re.split(r"(?<=[.!?:])\s+", line.strip()):
            toks = re.findall(r"[A-Za-z][A-Za-z0-9'.&-]*", sent)
            for i, tok in enumerate(toks):
                if i == 0 or not tok[0].isupper():
                    continue
                w = tok.lower().strip(".'")
                if w in _COMMON_CAPS or w in vocab or w.rstrip("'s") in vocab:
                    continue
                problems.append(f"names '{tok.strip('.')}', which isn't in the brief")
    for phrase in L.FAKE_FAMILIARITY:
        if phrase in low:
            problems.append(f"pretends familiarity ('{phrase}')")
    seen, out = set(), []
    for p in problems:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out


def _sentences(text: str) -> list:
    return [s.strip().lower() for s in re.split(r"(?<=[.!?])\s+|\n+", text or "")
            if len(s.split()) >= 6]


def score_draft(subject: str, body: str, brief=None, *, step: int = 1, previous=None,
                template: bool = False, final: bool = False) -> dict:
    """Quality report for one draft: ``{score, grade, reasons, …}``.

    ``reasons`` lists what cost points (``{code, message, impact}``); ``good`` lists
    what's working. ``template`` relaxes checks that only make sense per person.
    """
    from openleads.outreach.compose import spam_lint
    subject, body = subject or "", body or ""
    reasons: list = []
    good: list = []

    def cost(code: str, message: str, impact: int) -> None:
        reasons.append({"code": code, "message": message, "impact": -impact})

    lint = spam_lint(subject, body)
    # spam_lint already counts length + placeholders; we score those separately.
    spam_warn = [w for w in lint["warnings"] if not w.startswith(("body is", "unfilled"))]
    spam_pts = min(40, sum(_spam_points(w) for w in spam_warn))
    for w in spam_warn:
        cost("spam", w[:1].upper() + w[1:], _spam_points(w))

    text = f"{subject}\n{body}"
    unresolved = _VAR_RE.findall(text) if not template else []
    brackets = [m for m in _BRACKET_RE.findall(_VAR_RE.sub("", text))
                if not re.fullmatch(r"\{[^{}]*\|[^{}]*\}", m) or not template]
    if unresolved:
        cost("variables", "Unfilled variables: " + ", ".join(sorted(set(unresolved))[:4]), 40)
    if brackets:
        cost("placeholder", "Placeholder text left in: " + ", ".join(brackets[:3]), 40)

    n = len(words(body))
    lo, hi = (50, 120) if step <= 1 else (20, 90)
    if n < lo:
        cost("short", f"Body is short ({n} words, aim for {lo}–{hi})", 6 if step > 1 else 10)
    elif n > hi + 60:
        cost("long", f"Body is long ({n} words, aim for {lo}–{hi})", 20)
    elif n > hi:
        cost("long", f"Body is a bit long ({n} words, aim for {lo}–{hi})", 8)
    else:
        good.append(f"{n} words")

    grade = reading_grade(body)
    if grade > 12:
        cost("reading", f"Hard to read (grade {grade:g}); use shorter sentences and words", 12)
    elif grade > 9:
        cost("reading", f"Reading level is high (grade {grade:g})", 5)
    else:
        good.append(f"easy to read (grade {max(grade, 1):g})")

    links = _URL_RE.findall(text)
    if len(links) > 1:
        cost("links", f"{len(links)} links; cold email lands best with none or one", 8 * (len(links) - 1))
    elif links and step <= 1:
        cost("links", "A link in a first email can hurt deliverability", 4)
    if _ATTACH_RE.search(body):
        cost("attachment", "Mentions an attachment; cold email should have none", 10)

    low = body.lower()
    fam = [p for p in L.FAKE_FAMILIARITY if p in low]
    if fam:
        cost("familiarity", f"Pretends a relationship ('{fam[0]}')", 15)
    gen = [p for p in L.GENERIC_OPENERS if p in low]
    if gen:
        cost("generic", f"Generic phrasing ('{gen[0]}')", 6)

    if "?" not in body and not final:
        cost("ask", "No question: end with one clear ask", 8)

    first_line = body.strip().split("\n", 1)[0].strip()
    if brief is not None and not template:
        m = re.match(r"^(?:hi|hey|hello|dear)\s+([^,\n]+),", first_line, re.I)
        greeted = m.group(1).strip() if m else ""
        if greeted and brief.kind == "company" and greeted.lower() not in (
                "there", "team", f"{brief.company} team".lower()):
            cost("greeting", f"Greets '{greeted}' but this is a shared inbox", 25)
        elif greeted and brief.company and greeted.lower() == brief.company.split(" ")[0].lower() \
                and greeted != brief.first_name:
            cost("greeting", f"Greets '{greeted}', which is the company, not a person", 25)
        if brief.kind == "company" and step <= 1 and not re.search(
                r"right person|who (?:would|should|handles|looks after)|pass this along|point me",
                low):
            cost("inbox", "Shared inbox: ask who the right person is", 8)

    used: list = []
    available = 0
    if brief is not None:
        used = facts_used(text, brief)
        specific = [k for k in used if k not in ("person.first_name", "company.name")]
        available = len([f for f in brief.facts if f.weight >= 1])
        if step <= 1 and not template:
            if not specific:
                cost("personal", "Nothing in it is specific to this lead", 18)
            elif len(specific) == 1 and available > 2:
                cost("personal", "Uses one fact about the lead; there's more to work with", 4)
                good.append("uses 1 fact about the lead")
            else:
                good.append(f"uses {len(specific)} facts about the lead")
        if not brief.sender.get("pitch") and not template:
            cost("pitch", "No pitch in Settings, so it can't say what you offer", 6)

    if previous and step > 1:
        prev = set()
        for p in previous:
            prev.update(_sentences(p.get("body", "") if isinstance(p, dict) else str(p)))
        rep = [s for s in _sentences(body) if s in prev]
        if rep:
            cost("repeat", "Repeats a sentence from an earlier email", 15)
        else:
            good.append("doesn't repeat the earlier email")

    if len(subject) > 60:
        cost("subject", f"Subject is long ({len(subject)} characters)", 5)
    if not subject.strip():
        cost("subject", "No subject", 15)

    score = 100 - spam_pts - sum(-r["impact"] for r in reasons if r["code"] != "spam")
    score = max(0, min(100, score))
    return {
        "score": score, "grade": "good" if score >= 80 else "ok" if score >= 60 else "weak",
        "reasons": sorted(reasons, key=lambda r: r["impact"]), "good": good,
        "words": n, "reading_grade": grade, "links": len(links),
        "missing_vars": sorted(set(v.strip("{} ").split("|")[0] for v in unresolved)),
        "personalization": {"used": used, "count": len([k for k in used if k not in (
            "person.first_name", "company.name")]), "available": available},
        "spam": {"score": lint["score"], "warnings": spam_warn},
    }


def _spam_points(warning: str) -> int:
    if warning.startswith("spam-trigger"):
        return min(30, 8 * (warning.count(",") + 1))
    if "UPPERCASE" in warning:
        return 15
    if "exclamation" in warning:
        return 10
    if "links" in warning:
        return 0                     # scored with the link check
    if "money" in warning:
        return 6
    return 5
