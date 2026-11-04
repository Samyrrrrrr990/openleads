# Writing emails

OpenLeads writes every cold email from a **research brief**: what a search, an
import or a company profile already found about that lead. It doesn't scrape
anything new to write, and it never mentions a fact the brief doesn't hold.

It works with nothing configured (the built-in writer). With an LLM set up it
writes better prose from the same brief, and every LLM draft is checked against
the brief before you see it.

## Before and after

The same lead, the same pitch in Settings ("We help growing teams fill their
calendar with qualified meetings, without buying a contact database.").

**Before (5.1)** — every lead got this, with only the name, title and company
swapped in. The sequence's own pitch was dropped, so this line was the default:

```
Subject: quick question about northwind dental

Hey Maya,

I came across your work as Owner & Lead Dentist and wanted to reach out. We're
reaching out about a potential collaboration.

Would you be open to a quick chat? Happy to work around your schedule.

Best,
Sam
```

**After (5.2, built-in writer, no key)** — `openleads write --to maya@… --explain`:

```
── maya.okafor@northwind-dental.example ── quality 100/100, curiosity
  brief: Maya Okafor (person), Owner & Lead Dentist at Northwind Dental
    Title: Owner & Lead Dentist [contact]
    Tech stack: WordPress, Zocdoc, Google Analytics, Podium [homepage]
    Industry: Dental [source]
    Team size: 24 people [profile]
    Location: Austin, TX [source]
    Your pitch is about: booking new sales meetings
Subject: sales meetings at Northwind Dental
Hi Maya,

With 24 people at Northwind Dental, how are you handling booking new sales
meetings? Figured you'd be the right person to ask as Owner & Lead Dentist there.

We help growing teams fill their calendar with qualified meetings, without buying
a contact database.

Open to a short call to see if it fits?

Best,
Sam
Slotfill
  why angle: curiosity — we know something specific about the company
  why opener: "With 24 people at Northwind Dental, …" — their team size
  why why you: "Figured you'd be the right person …" — their title
  why value: "We help growing teams …" — your pitch, from Settings
```

A shared inbox. **Before**, `info@northwind-dental.example` (saved with the
company's name) got `Hey Northwind,` and a pitch as if it were the owner.
**After**:

```
Subject: who handles sales meetings at Northwind Dental?

Hi Northwind Dental team,

I'm hoping to reach the right person at Northwind Dental for this.

We help growing teams fill their calendar with qualified meetings, without buying
a contact database.

Could you point me to the right person, or pass this along?
```

A follow-up (`--step 2`) stays in the thread and adds something new instead of
repeating the first email:

```
Subject: re: sales meetings at Helio Payments

Hi Lucas,

Following up on my note below. Curious how Helio Payments handles booking new
sales meetings today.

Any interest?
```

The last email of three or more closes the loop ("I'll close the loop here so
I'm not filling up your inbox…").

## The research brief

`openleads.writing.build_brief(lead, sender)` is a pure function. It reads:

- **The person**: a clean first name (never the company's first word, never a
  role mailbox like `info@`), a real job title (a GitHub bio is kept as a bio,
  "Hiring" as a signal), seniority and department.
- **The company**: name, the homepage one-liner (when it says more than the name
  and industry), industry, size, location, and the tech stack worth mentioning
  (CRM, scheduling, e-commerce… not fonts or CDNs).
- **Signals the source provides**: hiring (HN "Who is hiring"), Y Combinator, a
  GitHub profile or repo, a paper, a Product Hunt launch.
- **Evidence**: how the address is known (found, pattern, guessed).
- **You**: name, company, pitch, offer and proof from Settings, Sender identity.

Each fact has a key, a label, the exact wording the writer may use, a weight and
where it came from. `gaps` lists what's missing ("No pitch set…").

## Angles, tones, variants

| Angle | Opens with | Needs |
|---|---|---|
| `mutual-signal` | a real, recent signal: hiring, YC, a repo, a paper, a stack overlap with your pitch | a signal |
| `compliment` | an honest observation: their homepage line, their stack | a description or stack |
| `curiosity` | a question about how they handle what your pitch solves | a pitch topic |
| `pain` | a common problem for their role or vertical, said as a pattern | a pitch topic |
| `short-ask` | two lines: what you do, is it relevant? | nothing |

Leave the angle on auto and it's picked from the brief. If you ask for one the
lead can't support (a compliment with nothing to compliment), the writer says so
in the explanation and picks another. Shared inboxes always get the "who should I
talk to" email.

Choices are **deterministic per lead**: re-running a campaign reproduces the same
drafts, while two people at the same company get different openers, asks and
subjects. Tones: `plain`, `warm`, `direct`, `casual`. Subjects come in a
lowercase-casual and a plain-case form (`subject_options`); variant B uses the
other one.

`--variants N` (or the Compose page's "2 versions") writes N versions per lead,
each on a different eligible angle, all scored.

## The quality gate

Every draft, template preview and sequence preview gets a score from 0 to 100
with the reasons that cost points:

- spam-trigger words, shouting, exclamation marks, money amounts (the existing
  `spam_lint`);
- length (50–120 words for a first email, 20–90 for a follow-up) and reading
  level (Flesch–Kincaid grade);
- personalization: how many brief facts it actually uses;
- links (none or one) and attachments (none);
- unfilled `{{variables}}` or `[placeholders]`;
- a greeting that's really a company name, or a shared inbox that isn't asked
  for the right person;
- fake familiarity ("as we discussed", "big fan", "hope this finds you well") and
  generic openers ("I wanted to reach out");
- no question to answer; for follow-ups, repeating the earlier email.

## With an LLM

Set either of these in Settings, AI writing (or `openleads config`):

- an **OpenRouter key** (`openrouter_api_key`, model `openrouter_model`), or
- **any OpenAI-compatible endpoint**: `ai_base_url` (e.g.
  `http://localhost:11434/v1` for Ollama), `ai_api_key` if it needs one, and
  `ai_model`.

The model gets the brief (facts only), your writing samples
(`writing_examples`, for voice, never facts) and strict rules: only facts from
the brief, no fake familiarity, the length, one ask, plain text, JSON out
(`subject`, `body`, `variants`). Then every draft is **facts-checked**: numbers,
names, tools and places that aren't in the brief get it rejected. On a
rejection, a timeout (`ai_timeout`, 20 s by default), a bad reply or any error,
the built-in writer's draft is used and the explanation says why.
`writing_llm = off` turns the LLM off for drafting.

## Rewrites, Generate and Improve

- **Rewrite** a draft: `shorter`, `warmer`, `more direct`, `more casual`. Without
  an LLM these are rule edits (cut filler and the least important sentences,
  soften or sharpen the ask, contractions); they only move or cut words, so they
  can't add a fact. With an LLM the model rewrites and is facts-checked too.
- **Generate step** (Templates, sequence editor) writes a reusable step with
  `{{variables}}` from your pitch: a first email (curiosity, pain, short ask), a
  follow-up, a yes/no nudge or a breakup. Compliment and mutual-signal need facts
  about each person, so for those turn on **AI-write** on the step instead.
- **Improve** fixes what the gate flags in a template: spam words, shouting,
  extra links, fake familiarity, missing `{{first_name|there}}` fallbacks, no
  ask, too long. It never touches your other variables.

Templates can use `{{sender_offer}}` and `{{sender_proof}}` alongside
`{{sender_context}}`.

## Where it shows up

- **CLI**: `openleads write` takes `--to EMAIL` (saved contacts), `--from CSV`
  or a search, plus `--angle`, `--variants N`, `--tone`, `--step N`,
  `--llm / --no-llm` and `--explain` (prints the brief and why each line was
  chosen). `-o drafts.json` saves drafts with their scores and briefs.
  `openleads run` drafts with the same writer.
- **Dashboard**: Compose shows the brief and the score beside each draft, with
  angle/tone/versions controls, A/B tabs and one-click rewrites; edits are
  re-scored as you type. Templates and the sequence editor have Generate step and
  Improve; previews show the score.
- **Sequences**: an AI-written step knows its position. Step 1 opens, later
  steps follow up in the same thread with something new, and the last of three
  or more is the breakup. The sequence's pitch is used.
- **MCP**: `draft_email` returns subject, body, score, reasons and the brief.
- **API**: `POST /api/write` (`leads`, `angle`, `tone`, `variants`, `step`,
  `llm`), `/api/write/rewrite`, `/api/write/brief`, `/api/write/score`,
  `/api/templates/generate`, `/api/templates/improve`.

## Python entry point

One stable function, for scripts, recipes and workflow nodes:

```python
from openleads.writers import write_email   # same as openleads.writing.write_email

draft = write_email(lead, angle=None, step=1, settings=None, variants=1, llm=None)
```

- `lead`: a `Lead`, its `to_dict()`, or a workspace contact row.
- `angle`: `None`/`"auto"`, `"mutual-signal"`, `"compliment"`, `"curiosity"`,
  `"pain"`, `"short-ask"`, or `"breakup"`.
- `step`: 1 for the first email, 2+ for follow-ups (`final=True` for the
  breakup; `thread_subject=` to thread under a known subject; `previous=` the
  earlier emails, to avoid repeating them).
- `settings`: overrides for this call: `sender_name`, `sender_org`,
  `sender_context` (pitch), `sender_offer`, `sender_proof`, `writing_tone`,
  `writing_examples`, and LLM keys (`ai_base_url`, `ai_api_key`, `ai_model`,
  `writing_llm`).
- `variants`: 1–5. `llm`: `None` (use one if configured), `False` (built-in
  writer only), or a dict of LLM settings. `tone=` overrides the tone.

It returns a `Draft` with `subject`, `body`, `model` (`"writer"` or the LLM model),
`lint`, `quality` (`score`, `grade`, `reasons`, `good`, `words`,
`reading_grade`, `personalization`), `brief`, `angle`, `step`, `variants`
(`[{subject, body, angle, model, quality}]` when more than one), `explain`
(`[{slot, text, why}]`) and `subject_options`. It doesn't raise for a lead with
an email, and it makes no network call unless an LLM is configured.

`openleads.outreach.compose.draft(lead, overrides)` keeps working and now calls
the same writer. Related helpers: `writing.rewrite(draft, mode, lead)`,
`writing.brief_for(lead)`, `writing.score_draft(subject, body, brief)`,
`writing.generate_template(...)`, `writing.improve_template(subject, body)`.
