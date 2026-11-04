"""
Keyless rewrites (shorter, warmer, more direct, more casual) and template help
("Improve" and "Generate step" in the Templates page and the sequence editor).

Rewrites only move, cut or soften words that are already there, so they can't add
a fact. Template generation writes ``{{variables}}`` instead of one person's
details, and "Improve" fixes what the quality gate flags without touching the
variables a template relies on.
"""
from __future__ import annotations

import re

from openleads.writing import library as L

_GREETING_RE = re.compile(r"^(hi|hey|hello|dear|good (?:morning|afternoon))\b", re.I)
_FILLER = (
    r"I hope (?:this|my) (?:email|note|message) finds you well\.?",
    r"I hope you(?:'re| are) (?:doing )?well\.?",
    r"Hope you(?:'re| are) (?:doing )?well\.?",
    r"Happy to work around your schedule\.?",
    r"No worries if the timing's off\.?",
    r"No pressure either way\.?",
    r"That's rarer than it should be\.?",
    r"I wanted to reach out (?:because|as|since)\s*",
    r"I'm reaching out (?:because|as|since)\s*",
    r"Just wanted to (?:say|reach out|check in)[^.?!]*[.?!]?",
)
_HEDGES = (r"\bjust\s+", r"\bI think\s+", r"\bI was wondering if\s+", r"\bmaybe\s+",
           r"\bperhaps\s+", r"\bkind of\s+", r"\bsort of\s+", r"\breally\s+", r"\bactually\s+")
_CONTRACTIONS = (("I am", "I'm"), ("I would", "I'd"), ("I have", "I've"), ("I will", "I'll"),
                 ("we are", "we're"), ("We are", "We're"), ("you are", "you're"),
                 ("it is", "it's"), ("It is", "It's"), ("that is", "that's"),
                 ("That is", "That's"), ("do not", "don't"), ("does not", "doesn't"),
                 ("cannot", "can't"), ("would not", "wouldn't"), ("is not", "isn't"),
                 ("we have", "we've"), ("We have", "We've"), ("let us", "let's"))
_SIGNOFF_RE = re.compile(r"^(best|thanks|thank you|cheers|regards|kind regards|all the best|"
                         r"warmly|thanks so much|many thanks|best regards)\b[^\n]*", re.I)


def split(body: str) -> tuple:
    """``(greeting, paragraphs, signoff)``."""
    paras = [p.strip() for p in re.split(r"\n\s*\n", (body or "").strip()) if p.strip()]
    greeting = paras.pop(0) if paras and _GREETING_RE.match(paras[0]) and \
        len(paras[0].split()) <= 6 and "\n" not in paras[0] else ""
    signoff = ""
    if paras and (_SIGNOFF_RE.match(paras[-1]) or (len(paras[-1].split()) <= 4 and "?" not in paras[-1])):
        signoff = paras.pop()
    return greeting, paras, signoff


def join(greeting: str, paras: list, signoff: str) -> str:
    return "\n\n".join(p for p in [greeting] + [x for x in paras if x.strip()] + [signoff] if p).strip()


def _sentences(text: str) -> list:
    return [s for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s.strip()]


def _tidy(text: str) -> str:
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r" +([,.!?])", r"\1", text)
    text = re.sub(r"(^|[.!?]\s+)([a-z])", lambda m: m.group(1) + m.group(2).upper(), text)
    return text.strip()


def _swap_signoff(signoff: str, word: str) -> str:
    if not signoff:
        return word
    lines = signoff.split("\n")
    if _SIGNOFF_RE.match(lines[0]):
        lines[0] = word
    else:
        lines.insert(0, word)
    return "\n".join(lines)


def _last_question(paras: list) -> tuple:
    for i in range(len(paras) - 1, -1, -1):
        sents = _sentences(paras[i])
        for j in range(len(sents) - 1, -1, -1):
            if sents[j].endswith("?"):
                return i, j
    return None, None


def rewrite_text(subject: str, body: str, mode: str) -> dict:
    """Rewrite with rules only → ``{subject, body, changes}``."""
    mode = (mode or "").lower().replace("_", " ").replace("-", " ").strip()
    mode = {"short": "shorter", "warm": "warmer", "direct": "more direct",
            "casual": "more casual"}.get(mode, mode)
    if mode not in L.REWRITES:
        raise ValueError(f"unknown rewrite '{mode}' (choose {', '.join(L.REWRITES)})")
    greeting, paras, signoff = split(body)
    changes: list = []
    if mode == "shorter":
        before = sum(len(p.split()) for p in paras)
        text = " \n".join(paras)
        for pat in _FILLER:
            text = re.sub(pat, "", text, flags=re.I)
        paras = [_tidy(p) for p in text.split(" \n") if p.strip()]
        sents = [(i, s) for i, p in enumerate(paras) for s in _sentences(p)]
        qi = max((k for k, (_, s) in enumerate(sents) if s.endswith("?")), default=None)
        budget = max(40, int(before * 0.65))
        # Always the opener, the first sentence of the next paragraph (the pitch) and the ask.
        lead_of = {}
        for k, (i, _) in enumerate(sents):
            lead_of.setdefault(i, k)
        must = {0, qi} | ({lead_of[1]} if 1 in lead_of and len(paras) > 2 else set())
        keep, n = set(), 0
        for k, (_, s) in enumerate(sents):
            if k in must:
                keep.add(k)
                n += len(s.split())
        for k, (_, s) in enumerate(sents):
            if k not in keep and n + len(s.split()) <= budget:
                keep.add(k)
                n += len(s.split())
        out: dict = {}
        for k, (i, s) in enumerate(sents):
            if k in keep:
                out.setdefault(i, []).append(s)
        paras = [" ".join(out[i]) for i in sorted(out)]
        after = sum(len(p.split()) for p in paras)
        if after < before:
            changes.append(f"cut {before - after} words")
    elif mode == "warmer":
        greeting = re.sub(r"^(hey|hello)\b", "Hi", greeting, flags=re.I) if greeting else greeting
        qi, qj = _last_question(paras)
        if qi is not None:
            sents = _sentences(paras[qi])
            q = sents[qj]
            q2 = re.sub(r"^Do you have", "Would you have", q)
            q2 = re.sub(r"^Can we", "Could we", q2)
            q2 = re.sub(r"^Up for", "Would you be up for", q2)
            if q2 != q:
                sents[qj] = q2
                changes.append("softened the ask")
            paras[qi] = " ".join(sents)
        if not any(s.lower() in " ".join(paras).lower() for s in L.SOFT_LINES):
            paras.append(L.SOFT_LINES[0])
            changes.append("added a no-pressure line")
        signoff = _swap_signoff(signoff, "Thanks so much,")
        changes.append("warmer sign-off")
    elif mode == "more direct":
        text = "\n\n".join(paras)
        for pat in _FILLER + _HEDGES:
            text = re.sub(pat, "", text, flags=re.I)
        paras = [_tidy(p) for p in text.split("\n\n") if p.strip()]
        qi, qj = _last_question(paras)
        if qi is not None:
            sents = _sentences(paras[qi])
            if re.search(r"\b(open to|would you|could we|if it sounds|be up for)\b", sents[qj], re.I):
                sents[qj] = "Do you have 15 minutes this week?"
                changes.append("made the ask direct")
            paras[qi] = " ".join(sents[:qj + 1])
        changes.append("removed hedges and filler")
        signoff = _swap_signoff(signoff, "Thanks,")
    else:  # more casual
        greeting = re.sub(r"^(hi|hello|dear)\b", "Hey", greeting, flags=re.I) if greeting else greeting
        text = "\n\n".join(paras)
        for a, b in _CONTRACTIONS:
            text = re.sub(r"\b" + re.escape(a) + r"\b", b, text)
        paras = text.split("\n\n")
        signoff = _swap_signoff(signoff, "Cheers,")
        if subject and not subject.lower().startswith("re:") and "{{" not in subject:
            words = subject.split(" ")
            if words and words[0][:1].isupper() and words[0][1:].islower():
                subject = words[0].lower() + (" " + " ".join(words[1:]) if len(words) > 1 else "")
        changes.append("contractions, a lighter greeting and sign-off")
    return {"subject": subject, "body": join(greeting, paras, signoff), "changes": changes}


# --- templates ---------------------------------------------------------------- #
_SPAM_FIXES = (
    (r"\bfeel free to\b", "you're welcome to"), (r"\b100% free\b", ""), (r"\brisk-free\b", "low-risk"),
    (r"\bfree trial\b", "trial"), (r"\bfor free\b", "at no charge"), (r"\bfree\b", ""),
    (r"\bguaranteed\b", "reliable"), (r"\bguarantee\b", "promise"), (r"\bact now\b", ""),
    (r"\blimited time\b", ""), (r"\bclick here\b", ""), (r"\bbuy now\b", ""),
    (r"\border now\b", ""), (r"\burgent\b", "important"), (r"\bamazing\b", "useful"),
    (r"\bincredible\b", "real"), (r"\bmiracle\b", ""), (r"\bcheap\b", "affordable"),
    (r"\bdiscount\b", "lower price"), (r"\b(?:best|lowest) price\b", "fair price"),
    (r"\bincrease sales\b", "grow revenue"), (r"\b(?:make|earn) money\b", "grow revenue"),
    (r"\bno cost\b", "no charge"), (r"\bcongratulations\b", "congrats"),
)


def improve_text(subject: str, body: str, *, template: bool = True) -> dict:
    """Fix what the quality gate flags, keeping ``{{variables}}`` → ``{subject, body, changes}``."""
    changes: list = []
    s, b = subject or "", body or ""
    for pat, rep in _SPAM_FIXES:
        for name, val in (("subject", s), ("body", b)):
            new = re.sub(pat, rep, val, flags=re.I)
            if new != val:
                changes.append(f"replaced '{re.search(pat, val, re.I).group(0)}'"
                               + (f" with '{rep}'" if rep else "") + f" in the {name}")
                if name == "subject":
                    s = new
                else:
                    b = new
    letters = [c for c in s if c.isalpha()]
    if len(letters) > 4 and sum(c.isupper() for c in letters) / len(letters) > 0.5:
        s = s.lower()
        changes.append("stopped the subject shouting")
    if s.count("!") or b.count("!") > 1:
        s = s.replace("!", "")
        b = re.sub(r"!+", ".", b)
        changes.append("removed exclamation marks")
    urls = re.findall(r"https?://\S+", b)
    for u in urls[1:]:
        b = b.replace(u, "")
    if len(urls) > 1:
        changes.append(f"removed {len(urls) - 1} extra link(s)")
    sents_removed = 0
    for phrase in L.FAKE_FAMILIARITY + ("i hope you", "hope you're doing"):
        pat = re.compile(r"[^.!?\n]*" + re.escape(phrase) + r"[^.!?\n]*[.!?]?\s*", re.I)
        b, k = pat.subn("", b)
        sents_removed += k
    if sents_removed:
        changes.append("removed lines that fake familiarity")
    if template:
        def fallback(m):
            name, fb = m.group(1), m.group(2)
            if fb is not None:
                return m.group(0)
            default = {"first_name": "there", "first": "there", "company": "your team",
                       "city": "your area", "title": "your role", "industry": "your space"}.get(name)
            if not default:
                return m.group(0)
            changes.append(f"added a fallback to {{{{{name}}}}}")
            return "{{" + name + "|" + default + "}}"
        b = re.sub(r"\{\{\s*([a-zA-Z_]\w*)\s*(\|[^}]*)?\}\}",
                   lambda m: fallback(m) if m.group(2) is None else m.group(0), b)
    greeting, paras, signoff = split(b)
    if "?" not in b:
        paras.append("Worth a quick chat next week?")
        changes.append("added a clear ask")
    b = join(greeting, paras, signoff)
    n = len(re.findall(r"\w+", b))
    if n > 150:
        r = rewrite_text(s, b, "shorter")
        b = r["body"]
        changes.append(f"shortened from {n} words")
    b = "\n".join(_tidy_line(x) for x in b.split("\n"))
    s = " ".join(s.split())
    seen, out = set(), []
    for c in changes:
        if c not in seen:
            seen.add(c)
            out.append(c)
    return {"subject": s, "body": b.strip(), "changes": out}


def _tidy_line(line: str) -> str:
    line = re.sub(r"[ \t]{2,}", " ", line)
    return re.sub(r" +([,.!?])", r"\1", line).rstrip()
