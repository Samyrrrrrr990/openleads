"""
OpenLeads' email writer: research brief → draft → quality gate.

One entry point does it all::

    from openleads.writers import write_email      # or: from openleads.writing import write_email
    draft = write_email(lead, angle=None, step=1, variants=2)
    draft.subject, draft.body, draft.quality["score"], draft.brief["facts"]

* **Keyless by default.** :mod:`~openleads.writing.keyless` assembles short, natural
  emails from a phrase library, chosen deterministically per lead from the
  :mod:`~openleads.writing.brief` (what we already know: company, stack, signals,
  role, the sender's pitch). Same lead, same draft; different leads, varied copy.
* **Better with an LLM.** When an OpenRouter key or any OpenAI-compatible endpoint is
  configured, :mod:`~openleads.writing.llm` drafts from the same brief under strict
  rules and every draft is facts-checked. Any failure falls back to the keyless writer.
* **Every draft is scored** by :mod:`~openleads.writing.quality` (0–100 with reasons).
"""
from __future__ import annotations

from openleads.writing import keyless
from openleads.writing import library as L
from openleads.writing import llm as llmmod
from openleads.writing.brief import Brief, Fact, build_brief, sender_profile
from openleads.writing.quality import facts_check, score_draft
from openleads.writing.rewrite import improve_text, rewrite_text

__all__ = ["write_email", "rewrite", "brief_for", "generate_template", "improve_template",
           "build_brief", "sender_profile", "score_draft", "facts_check", "Brief", "Fact",
           "ANGLES", "TONES", "REWRITES"]

ANGLES, TONES, REWRITES = L.ANGLES, L.TONES, L.REWRITES
KEYLESS_MODEL = "writer"


def brief_for(lead, settings: dict | None = None) -> Brief:
    """The research brief for ``lead`` using the sender profile from Settings (+ overrides)."""
    return build_brief(lead, sender_profile(settings))


def _llm_config(llm, settings):
    if llm is False:
        return None
    if isinstance(llm, llmmod.LLMConfig):
        return llm
    if isinstance(llm, dict):
        return llmmod.config({**(settings or {}), **llm})
    return llmmod.config(settings)


def _variant_angles(b: Brief, angle, n: int) -> list:
    """The angle for each variant: the asked/auto angle first, then other eligible ones."""
    if b.kind == "company":
        return ["inbox"] * n
    if angle and angle != "auto":
        return [angle] * n
    first, _ = keyless.auto_angle(b)
    others = [a for a in keyless.eligible_angles(b) if a != first]
    order = [first] + others
    return [order[i % len(order)] for i in range(n)]


def _as_previous(previous) -> list:
    out = []
    for p in previous or []:
        if isinstance(p, dict):
            out.append({"subject": p.get("subject", ""), "body": p.get("body", "")})
        elif hasattr(p, "subject"):
            out.append({"subject": p.subject, "body": p.body})
        else:
            out.append({"subject": "", "body": str(p)})
    return out


def write_email(lead, *, angle: str | None = None, step: int = 1, settings: dict | None = None,
                variants: int = 1, llm=None, tone: str | None = None, final: bool = False,
                thread_subject: str = "", previous=None, http=None):
    """Write one cold email (and optional A/B variants) for ``lead`` → :class:`Draft`.

    ``lead``      a :class:`~openleads.models.Lead`, its dict, or a workspace contact row.
    ``angle``     mutual-signal | compliment | curiosity | pain | short-ask (None = pick
                  from the brief). Company inboxes always get the "who should I talk to" email.
    ``step``      1 = first email; 2+ = follow-ups in the same thread. ``final=True``
                  (or ``angle="breakup"``) writes the polite last email.
    ``settings``  overrides for the sender profile: sender_name, sender_org, sender_context
                  (pitch), sender_offer, sender_proof, writing_tone, writing_examples, and
                  LLM keys (ai_base_url, ai_api_key, ai_model, writing_llm). Old ``compose``
                  names (context, sender, org, api_key, model) work too.
    ``variants``  how many versions to write (A/B); all are in ``draft.variants``.
    ``llm``       None = use one if configured; False = keyless only; True = same as None;
                  a dict of LLM settings, or an :class:`~openleads.writing.llm.LLMConfig`.
    ``tone``      plain | warm | direct | casual (default: Settings → AI writing).

    The returned draft carries ``quality`` (0–100 + reasons), ``brief``, ``angle``,
    ``variants`` and ``explain`` (why each line was chosen). Never raises for a lead
    with an email; never invents a fact that isn't in the brief.
    """
    from openleads.models import Draft
    from openleads.outreach.compose import spam_lint
    settings = dict(settings or {})
    b = brief_for(lead, settings)
    tone = (tone or b.sender.get("tone") or "plain").lower()
    tone = tone if tone in L.TONES else "plain"
    n = max(1, min(int(variants or 1), 5))
    step = max(1, int(step or 1))
    if angle == "breakup":
        final, angle = True, None
    if angle and angle not in L.ANGLES and angle != "auto":
        raise ValueError(f"unknown angle '{angle}' (choose {', '.join(L.ANGLES)})")
    if final and step < 2:
        step = 2

    # Keyless drafts (always: they're the fallback and the explanation baseline).
    angles = _variant_angles(b, angle, n)
    first0 = keyless.first_email(b, angle if angle and angle != "auto" else None, tone, 0)
    angles[0] = first0.angle
    prev = _as_previous(previous)
    if step > 1 and not prev:
        prev = [{"subject": first0.subject, "body": first0.body}]
    thread = thread_subject or (prev[0]["subject"] if prev else "")
    emails = []
    for k in range(n):
        if step <= 1:
            e = first0 if k == 0 else keyless.first_email(b, angles[k], tone, k)
            if k and not angle and b.kind != "company":
                e.explain = [dict(x, why="variant " + chr(65 + k) + " tries another angle")
                             if x["slot"] == "angle" else x for x in e.explain]
        else:
            e = keyless.follow_up(b, step, first0, tone, k, final=final, thread_subject=thread)
        emails.append({"subject": e.subject, "body": e.body, "angle": e.angle, "model": KEYLESS_MODEL,
                       "explain": e.explain, "subject_options": e.subject_options})

    # LLM drafts, when configured; any failure keeps the keyless ones.
    cfg = _llm_config(llm, settings)
    notes = []
    if cfg is not None:
        llm_angle = "breakup" if final else ("follow-up" if step == 2 else "nudge") if step > 1 \
            else emails[0]["angle"]
        try:
            got = llmmod.generate(b, cfg, angle=llm_angle, step=step, tone=tone, n=n,
                                  previous=prev if step > 1 else None, http=http)
            for k, g in enumerate(got[:n]):
                emails[k] = {"subject": g["subject"], "body": g["body"],
                             "angle": emails[k]["angle"], "model": cfg.label,
                             "explain": [{"slot": "writer", "text": cfg.label,
                                          "why": "LLM draft from the brief; passed the facts check"}]
                             + [x for x in emails[k]["explain"] if x["slot"] == "angle"],
                             "subject_options": [g["subject"]]}
        except llmmod.LLMError as err:
            notes.append({"slot": "writer", "text": KEYLESS_MODEL,
                          "why": f"LLM ({cfg.label}) not used: {err}; the built-in writer wrote this"})
    else:
        why = "no LLM configured" if llm is not False else "keyless (LLM turned off for this draft)"
        notes.append({"slot": "writer", "text": KEYLESS_MODEL, "why": why})

    for em in emails:
        em["quality"] = score_draft(em["subject"], em["body"], b, step=step, final=final,
                                    previous=prev if step > 1 else None)
    main = emails[0]
    explain = notes + main["explain"] if main["model"] == KEYLESS_MODEL else main["explain"]
    return Draft(
        email=b.email, subject=main["subject"], body=main["body"], first_name=b.first_name,
        organization=b.company, lint=spam_lint(main["subject"], main["body"]),
        model=main["model"], quality=main["quality"], brief=b.to_dict(), angle=main["angle"],
        step=step, explain=explain, subject_options=main["subject_options"],
        variants=[{"subject": em["subject"], "body": em["body"], "angle": em["angle"],
                   "model": em["model"], "quality": em["quality"]} for em in emails] if n > 1 else [],
    )


def rewrite(draft, mode: str, lead=None, *, settings: dict | None = None, llm=None, http=None):
    """Rewrite a draft (shorter | warmer | more direct | more casual) → new :class:`Draft`.

    ``draft`` is a Draft or ``{subject, body, email}``. With an LLM configured the model
    rewrites it (facts-checked against the brief and the original text); otherwise, or
    on any failure, rule-based edits do it. Neither adds facts.
    """
    from openleads.models import Draft
    from openleads.outreach.compose import spam_lint
    d = draft.to_dict() if hasattr(draft, "to_dict") else dict(draft or {})
    subject, body = d.get("subject", ""), d.get("body", "")
    b = brief_for(lead or {"email": d.get("email", ""), "first_name": d.get("first_name", ""),
                           "organization": d.get("organization", "")}, settings)
    step = int(d.get("step") or (2 if subject.lower().startswith("re:") else 1))
    cfg = _llm_config(llm, settings)
    out, model, why = None, KEYLESS_MODEL, ""
    if cfg is not None:
        try:
            out = llmmod.rewrite(subject, body, mode, b, cfg, http=http)
            model, why = cfg.label, "rewritten by the LLM; passed the facts check"
        except llmmod.LLMError as err:
            why = f"LLM not used ({err}); rule-based rewrite"
    if out is None:
        out = rewrite_text(subject, body, mode)
        why = why or "rule-based rewrite: " + (", ".join(out["changes"]) or "no changes needed")
    q = score_draft(out["subject"], out["body"], b, step=step)
    return Draft(email=b.email or d.get("email", ""), subject=out["subject"], body=out["body"],
                 first_name=b.first_name, organization=b.company,
                 lint=spam_lint(out["subject"], out["body"]), model=model, quality=q,
                 brief=b.to_dict(), angle=d.get("angle", ""), step=step,
                 explain=[{"slot": "rewrite", "text": mode, "why": why}])


# --- templates -------------------------------------------------------------------- #
def _template_brief(settings: dict | None) -> Brief:
    sender = sender_profile(settings)
    real_pitch = sender.get("pitch", "")
    b = build_brief({"email": "", "first_name": "", "contact_type": "person"}, sender)
    b.kind = "person"
    b.seed = "template"
    b.first_name = "{{first_name|there}}"
    b.company = "{{company|your team}}"
    b.sender = {**b.sender, "pitch": "{{sender_context}}" if real_pitch else "",
                "name": "{{sender_name}}", "org": "",
                "offer": "{{sender_offer}}" if sender.get("offer") else "",
                "proof": "{{sender_proof}}" if sender.get("proof") else ""}
    b.facts, b.gaps = [], []
    return b


def generate_template(*, angle: str | None = None, step: int = 1, tone: str | None = None,
                      final: bool = False, settings: dict | None = None) -> dict:
    """A reusable template (with ``{{variables}}``) for a step → ``{subject, body, quality, explain}``.

    Per-person angles (mutual-signal, compliment) need facts about each contact; for
    those, the result says to use an AI-written step instead and falls back to a
    template-friendly angle.
    """
    b = _template_brief(settings)
    tone = tone if tone in L.TONES else (b.sender.get("tone") or "plain")
    if angle == "breakup":
        final, angle = True, None
    note = ""
    if angle in ("mutual-signal", "compliment"):
        note = (f"'{angle}' needs facts about each person, so this template uses a different angle. "
                "Turn on AI-write for the step to get it per person.")
        angle = None
    if angle not in (None, "auto") and angle not in L.ANGLES:
        raise ValueError(f"unknown angle '{angle}'")
    first = keyless.first_email(b, angle, tone, 0)
    if step > 1 or final:
        e = keyless.follow_up(b, max(2, step), first, tone, 0, final=final)
    else:
        e = first
    body = e.body
    explain = e.explain + ([{"slot": "note", "text": "", "why": note}] if note else [])
    q = score_draft(e.subject, body, None, step=max(1, step), template=True)
    return {"subject": e.subject, "body": body, "angle": e.angle, "quality": q,
            "explain": explain, "note": note}


def improve_template(subject: str, body: str, *, settings: dict | None = None, llm=None,
                     http=None) -> dict:
    """Fix a template's subject/body (spam words, shouting, links, missing fallbacks,
    fake familiarity, no ask, length) → ``{subject, body, changes, quality}``.

    ``llm`` defaults to keyless here: rule-based edits are predictable and keep every
    ``{{variable}}``; pass ``llm=True`` to let a configured model polish the wording.
    """
    import re as _re
    out = improve_text(subject, body, template=True)
    if llm:
        cfg = _llm_config(llm, settings)
        if cfg is not None:
            b = _template_brief(settings)
            try:
                r = llmmod.rewrite(out["subject"], out["body"], "clearer and more natural", b, cfg,
                                   http=http)
                keep = set(_re.findall(r"\{\{[^}]+\}\}", out["subject"] + out["body"]))
                got = set(_re.findall(r"\{\{[^}]+\}\}", r["subject"] + r["body"]))
                if keep == got:
                    out = {**out, "subject": r["subject"], "body": r["body"],
                           "changes": out["changes"] + ["polished by the LLM"]}
            except llmmod.LLMError:
                pass
    out["quality"] = score_draft(out["subject"], out["body"], None, template=True)
    out["before"] = score_draft(subject, body, None, template=True)["score"]
    return out
