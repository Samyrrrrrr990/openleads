"""
Optional LLM drafting over any OpenAI-compatible chat endpoint (OpenRouter by default).

The model gets the research brief and strict rules, and must answer with JSON
(``subject``, ``body``, ``variants``). Every draft it returns goes through
:func:`openleads.writing.quality.facts_check`; one that names something the brief
doesn't contain is rejected. Any failure (no key, timeout, HTTP error, bad JSON,
a rejected draft) raises :class:`LLMError`, and the caller falls back to the keyless
writer, so an LLM can only ever make drafts better, never break them.

The HTTP call is a plain function (``http(url, payload, headers, timeout) -> dict``),
so tests pass a fake one and never touch the network.
"""
from __future__ import annotations

import json
import re
import urllib.request
from dataclasses import dataclass

from openleads.writing import library as L

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


class LLMError(Exception):
    """The LLM path failed; the message says why (shown in the draft's explanation)."""


@dataclass
class LLMConfig:
    url: str
    api_key: str = ""
    model: str = ""
    timeout: float = 20.0
    provider: str = "openrouter"     # openrouter | custom

    @property
    def label(self) -> str:
        return self.model or self.provider


def endpoint(base_url: str) -> str:
    base = (base_url or "").strip().rstrip("/")
    if not base:
        return OPENROUTER_URL
    if base.endswith("/chat/completions"):
        return base
    return base + "/chat/completions"


def config(overrides: dict | None = None) -> LLMConfig | None:
    """The configured endpoint, or None when no LLM is set up (or it's turned off)."""
    from openleads import settings
    o = overrides or {}
    if str(o.get("writing_llm") or settings.get("writing_llm") or "auto") == "off":
        return None
    base = str(o.get("ai_base_url") or settings.get("ai_base_url") or "").strip()
    key = str(o.get("api_key") or o.get("ai_api_key") or settings.get("ai_api_key")
              or settings.get("openrouter_api_key") or "").strip()
    model = str(o.get("model") or o.get("ai_model") or settings.get("ai_model")
                or (settings.get("openrouter_model") if not base else "") or "").strip()
    try:
        timeout = float(o.get("ai_timeout") or settings.get("ai_timeout") or 20)
    except (TypeError, ValueError):
        timeout = 20.0
    if not base and not key:
        return None
    return LLMConfig(url=endpoint(base), api_key=key, model=model,
                     timeout=max(3.0, min(timeout, 120.0)),
                     provider="custom" if base else "openrouter")


def http_post_json(url: str, payload: dict, headers: dict, timeout: float) -> dict:
    """POST JSON with stdlib urllib and parse the JSON reply."""
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"),
                                 headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def chat(messages: list, cfg: LLMConfig, http=None, max_tokens: int = 900,
         temperature: float = 0.6) -> str:
    """One chat completion → the assistant's text. Raises :class:`LLMError`."""
    http = http or http_post_json
    headers = {"Content-Type": "application/json"}
    if cfg.api_key:
        headers["Authorization"] = f"Bearer {cfg.api_key}"
    if cfg.provider == "openrouter":
        headers["X-Title"] = "OpenLeads"
    payload = {"messages": messages, "max_tokens": max_tokens, "temperature": temperature}
    if cfg.model:
        payload["model"] = cfg.model
    try:
        data = http(cfg.url, payload, headers, cfg.timeout)
        content = data["choices"][0]["message"]["content"]
    except LLMError:
        raise
    except Exception as e:  # noqa: BLE001 — any transport/shape problem means "fall back"
        raise LLMError(f"{type(e).__name__}: {e}"[:200]) from None
    if not isinstance(content, str) or not content.strip():
        raise LLMError("empty reply")
    return re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL).strip()


def parse_json(text: str) -> dict:
    """The first JSON object in ``text`` (models sometimes wrap it in prose/fences)."""
    text = re.sub(r"^```(?:json)?|```$", "", (text or "").strip(), flags=re.M).strip()
    try:
        out = json.loads(text)
    except ValueError:
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if not m:
            raise LLMError("reply wasn't JSON") from None
        try:
            out = json.loads(m.group(0))
        except ValueError:
            raise LLMError("reply wasn't valid JSON") from None
    if not isinstance(out, dict):
        raise LLMError("reply wasn't a JSON object")
    return out


# --- prompts ------------------------------------------------------------------ #
ANGLE_HINTS = {
    "mutual-signal": "Open with the most specific signal in the brief (hiring, YC, a repo, a paper).",
    "compliment": "Open with one honest, specific observation from the brief. No flattery.",
    "curiosity": "Open with a genuine question about how they handle what the pitch solves.",
    "pain": ("Open with a common problem for people in their role, phrased as a pattern, "
             "not a claim about them."),
    "short-ask": "Two or three sentences: what the sender does, and is it relevant?",
    "inbox": "This is a shared inbox (info@, office@). Ask who the right person is; don't pitch hard.",
    "follow-up": "A short follow-up in the same thread. Add one new thing; don't repeat the first email.",
    "nudge": "A very short follow-up: one easy yes/no question.",
    "breakup": "The last email: close the loop politely, leave the door open. No guilt.",
}
TONE_HINTS = {"plain": "plain and friendly", "warm": "warm and human", "direct": "direct and brief",
              "casual": "casual, like a note to a peer"}


def brief_payload(brief) -> dict:
    """What the model is allowed to know: facts + sender, nothing else."""
    return {
        "recipient": {"kind": brief.kind, "first_name": brief.first_name or None,
                      "title": brief.title or None, "company": brief.company or None},
        "facts": [{"key": f.key, "fact": f.value} for f in brief.facts],
        "sender": {k: brief.sender.get(k) or None for k in ("name", "org", "pitch", "offer", "proof")},
        "topic": brief.topic_object if brief.topic else None,
    }


def build_messages(brief, *, angle: str, step: int = 1, tone: str = "plain", n: int = 1,
                   previous: list | None = None) -> list:
    words = "50-120" if step <= 1 else "25-80"
    examples = (brief.sender.get("examples") or "").strip()
    system = (
        "You write short, plain-text cold emails on behalf of the sender. Follow every rule:\n"
        "1. Use ONLY facts from the BRIEF. Never invent numbers, customers, results, funding, "
        "news, tools, places, mutual connections, or anything about the recipient.\n"
        "2. Never fake familiarity: no 'hope you're well', 'as we discussed', 'big fan', "
        "'I've been following', 'loved your post'.\n"
        f"3. Body {words} words, short sentences, about an 8th-grade reading level.\n"
        "4. Exactly one clear ask, as a question. No links, no attachments.\n"
        "5. Plain text only. No placeholders, [brackets] or {{braces}}. No em dashes. "
        "No spammy words (free, guarantee, act now, limited time, discount).\n"
        "6. Start with a greeting line ('Hi <first name>,' or 'Hi there,' if no name; "
        "'Hi <company> team,' for a shared inbox) and end with a sign-off and the sender's name.\n"
        "7. Subject: under 50 characters, lowercase is fine, no clickbait.\n"
        f"8. Tone: {TONE_HINTS.get(tone, TONE_HINTS['plain'])}.\n"
        + (f"9. Match the sender's voice from these examples of their own writing "
           f"(style only; don't copy their facts):\n---\n{examples[:1500]}\n---\n" if examples else "")
        + "Reply with ONLY a JSON object: {\"subject\": str, \"body\": str, "
        "\"variants\": [{\"subject\": str, \"body\": str}], \"facts_used\": [fact keys]}."
    )
    task = {"step": step, "angle": angle, "instruction": ANGLE_HINTS.get(angle, ""),
            "variants_wanted": max(0, n - 1), "brief": brief_payload(brief)}
    if previous:
        task["earlier_emails_in_thread"] = [
            {"subject": p.get("subject", ""), "body": p.get("body", "")} for p in previous[-2:]]
        task["instruction"] += (" Reply in the same thread and never repeat a sentence from the "
                                "earlier emails.")
    return [{"role": "system", "content": system},
            {"role": "user", "content": json.dumps(task, ensure_ascii=False)}]


def _candidates(data: dict) -> list:
    out = []
    if isinstance(data.get("subject"), str) and isinstance(data.get("body"), str):
        out.append({"subject": data["subject"], "body": data["body"]})
    for v in data.get("variants") or []:
        if isinstance(v, dict) and isinstance(v.get("subject"), str) and isinstance(v.get("body"), str):
            out.append({"subject": v["subject"], "body": v["body"]})
    return out


def tidy(subject: str, body: str, brief) -> tuple:
    from openleads.outreach.compose import clean_dashes, format_body
    subject = " ".join(clean_dashes(subject or "").split()).strip().strip('"')
    greet = brief.first_name or (f"{brief.company} team" if brief.kind == "company" and brief.company
                                 else "")
    body = format_body(clean_dashes(body or ""), greet)
    return subject, body


def check(subject: str, body: str, brief, *, step: int = 1) -> list:
    """Why a model draft can't be used (empty list = usable)."""
    from openleads.writing.quality import facts_check, score_draft, words
    problems = facts_check(subject, body, brief)
    n = len(words(body))
    if n < 15 or n > 220:
        problems.append(f"length {n} words")
    q = score_draft(subject, body, brief, step=step)
    problems += [r["message"] for r in q["reasons"]
                 if r["code"] in ("variables", "placeholder", "greeting", "familiarity")]
    if q["spam"]["score"] >= 35:
        problems.append("reads as spam")
    return problems


def generate(brief, cfg: LLMConfig, *, angle: str, step: int = 1, tone: str = "plain",
             n: int = 1, previous: list | None = None, http=None) -> list:
    """Model drafts that pass every check → ``[{subject, body}]``. Raises :class:`LLMError`."""
    text = chat(build_messages(brief, angle=angle, step=step, tone=tone, n=n, previous=previous),
                cfg, http=http)
    data = parse_json(text)
    good, rejected = [], []
    for c in _candidates(data):
        subject, body = tidy(c["subject"], c["body"], brief)
        if step > 1 and previous:
            base = (previous[0].get("subject") or "").strip()
            while base.lower().startswith("re:"):
                base = base[3:].strip()
            if base:
                subject = f"re: {base}"
        problems = check(subject, body, brief, step=step)
        if problems:
            rejected.append(problems[0])
        else:
            good.append({"subject": subject, "body": body})
    if not good:
        raise LLMError("draft rejected: " + (rejected[0] if rejected else "no subject/body in reply"))
    return good[:max(1, n)]


def rewrite(subject: str, body: str, mode: str, brief, cfg: LLMConfig, http=None) -> dict:
    """Rewrite one draft (shorter / warmer / more direct / more casual) with the model."""
    system = ("You edit cold emails. Rewrite the email to be " + mode + ". Keep every fact and "
              "the ask; add no new facts, names, numbers or claims. Plain text, no em dashes. "
              "Reply with ONLY JSON: {\"subject\": str, \"body\": str}.")
    user = json.dumps({"subject": subject, "body": body, "brief": brief_payload(brief)},
                      ensure_ascii=False)
    data = parse_json(chat([{"role": "system", "content": system},
                            {"role": "user", "content": user}], cfg, http=http, temperature=0.4))
    cands = _candidates(data)
    if not cands:
        raise LLMError("no subject/body in reply")
    s, b = tidy(cands[0]["subject"], cands[0]["body"], brief)
    if subject.lower().startswith("re:"):
        s = subject
    # The original text is allowed vocabulary too (the user may have added facts).
    from openleads.writing.quality import facts_check
    orig = {w.lower() for w in re.findall(r"[A-Za-z0-9]+", f"{subject} {body}")}
    problems = [p for p in facts_check(s, b, brief) if not _mentions_any(p, orig)]
    if problems:
        raise LLMError("rewrite rejected: " + problems[0])
    return {"subject": s, "body": b}


def _mentions_any(problem: str, words: set) -> bool:
    m = re.search(r"'([^']+)'|mentions ([A-Za-z0-9.+# -]+?),", problem)
    if not m:
        return False
    token = (m.group(1) or m.group(2) or "").lower()
    parts = re.findall(r"[a-z0-9]+", token)
    return bool(parts) and all(p in words for p in parts)


ALLOWED_ANGLES = set(L.ANGLES) | {"inbox", "follow-up", "nudge", "breakup"}
