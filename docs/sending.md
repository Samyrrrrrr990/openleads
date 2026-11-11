# Sending: cold email that lands, safely

OpenLeads sends over **your own** mailbox, with the guardrails that separate
"reaches the inbox" from "lands in spam / burns your domain." Everything here is
**dry-run by default**; real sends require an explicit `--live` (CLI) or the live
toggle (web), plus a confirmation.

> The finder never touches your mailbox. Only `run` / `send` / `campaign` do.

---

## 1. Connect a mailbox

```bash
openleads config
```

Pick a provider preset and supply an **app password** (not your account password):

| Provider | Host | Port | App-password docs |
|---|---|---|---|
| `gmail` / `workspace` | `smtp.gmail.com` | 465 (SSL) | Google App Passwords (needs 2FA) |
| `outlook` / `office365` | `smtp.office365.com` | 587 (STARTTLS) | Microsoft App Password (Security) |
| `zoho` | `smtp.zoho.com` | 465 (SSL) | Zoho app-specific password |
| `custom` | you set `smtp_host` | 465 or 587 | your provider |

Credentials are stored in `~/.openleads/secrets.json` (`chmod 600`). Env vars and a
local `.env` still take precedence (handy for CI), so nothing forces you to put
secrets in the store. Verify with `openleads doctor`, which attempts a real SMTP
login and reports the result.

## 2. The sender preflight

Before a single email goes out, `outreach/deliverability.py` audits **your sending
domain** and returns a readiness grade:

```
SPF      present        (+30)
DKIM     found          (+30)   ← selector probe / advisory
DMARC    p=quarantine   (+40)
─────────────────────────────
grade A · 100/100 · ready
```

- **SPF** authorizes your provider to send for your domain.
- **DKIM** cryptographically signs your mail.
- **DMARC** tells receivers what to do with unauthenticated mail (and `p=none` is
  weak, push toward `p=quarantine`).

Missing pieces are the #1 reason cold email hits spam. `doctor` and the dashboard's
Doctor page (the **Deliverability** badge in the sidebar) both surface the grade and
the exact fixes.

## 3. Warmup

Brand-new mailboxes that suddenly blast 200 emails get flagged. The warmup planner
(`deliverability.warmup_status`) computes today's allowance from a ramp:

```
warmup_start = 10     # day 1 allowance
warmup_step  = 5      # +5 each subsequent day
daily_cap    = 40     # hard ceiling
```

Day 1 → 10, day 2 → 15, … capped at `daily_cap`. The sender refuses to exceed the
day's allowance and tells you how many remain. Tune these in `openleads config`
(group `sending`).

## 4. How a send actually goes out

`outreach/sender.py`, for each recipient:

1. **Suppression check**: skips anyone bounced / unsubscribed / replied /
   do-not-contact / duplicate. The suppression list is permanent and local.
2. **Pre-send hook** (optional, off by default): asks your own check whether this
   email may go. See [the pre-send hook](#the-pre-send-hook) below.
3. **Warmup check**: stops at the day's allowance.
4. **Human pacing**: a randomized delay (`send_delay_min`–`send_delay_max` seconds,
   default 25–90) between real sends.
5. **Proper headers**: `Message-ID`, `Date`, threading headers, and
   **`List-Unsubscribe` + `List-Unsubscribe-Post`** (one-click). Plain-text default;
   **no open-tracking pixels**.
6. **Logged + resumable**: every attempt is written to the local CRM (`touches`), so
   a crashed batch resumes cleanly and reporting is exact.

By default OpenLeads sends **only to `safe`-tier** addresses. Opt into `risky` with
the `include_risky` setting (off is safer).

## 5. Drafting

The writer (`openleads.writing`) builds a **research brief** from what a search
already found about each lead (company, stack, hiring/YC/GitHub signals, the
person's role) and writes a short email that uses it:

- With nothing configured, the **built-in writer** composes it from a phrase
  library, deterministically per lead, and never mentions a fact the brief lacks.
- With an OpenRouter key or any OpenAI-compatible endpoint, an **LLM** writes from
  the same brief; its draft is facts-checked and the built-in writer takes over on
  any problem.

Every draft gets a **0-100 quality score** with reasons (spam words, length,
reading level, how personal it is, links, unfilled variables). Shared inboxes
(`info@`) get a "who should I talk to" email. You can edit any draft before
sending, in the web Compose page; your edits are exactly what's sent.

See [writing.md](writing.md) for angles, tones, variants, rewrites, the LLM
settings and before/after examples.

## 6. Sequences, follow-ups & reply detection

For multi-step outreach — emails with A/B variants and threaded follow-ups, plus
call and LinkedIn steps that become tasks — use **sequences**: the dashboard's
Sequences page or `openleads seq`. They send through this same sender, so every
guardrail below applies. See the [sequences guide](./sequences.md).

`outreach/inbox.py` (optional IMAP) detects replies and bounces; a reply **stops**
every sequence for that person, moves them to *Replied* and puts a "Reply to …"
task in your queue, and a bounce or unsubscribe updates suppression. Run:

```bash
openleads inbox --days 21
```

## 7. Commands

```bash
openleads run  "<query>"          # find → write → send (dry-run)
openleads run  "<query>" --live   # …for real
openleads send "<query>" --live   # same pipeline, terse output
openleads write "<query>" -o drafts.json   # stop after drafting
openleads write --to ann@acme.com --explain --variants 2   # a saved contact, with the brief
```

## The pre-send hook

Some checks only you can make: whether a cold email to this person is lawful where
they are, whether they're already a customer in another system, whether a teammate
is talking to them. The pre-send hook lets you plug any of those in. It's off until
you set it, and it only runs on real sends, never on previews or dry runs.

Set `presend_hook` to a shell command or a URL:

```bash
openleads config set presend_hook "python3 ~/bin/check_email.py"
openleads config set presend_hook https://checks.example.com/v1/email
```

OpenLeads sends each email as JSON (on stdin for a command, as a POST body for a
URL):

```json
{"to": "ada@globex.co.uk", "from": "you@yourco.com", "subject": "quick question",
 "body": "Hi Ada, ...", "first_email": true, "lead": {"organization": "Globex", "...": "..."}}
```

and expects one line of JSON back:

```json
{"action": "send"}
{"action": "hold", "reason": "UK sole trader: needs consent first (PECR reg 22)"}
```

A held email comes back as `skipped` with `held: <reason>`, goes on the contact's
timeline, and shows up in `openleads today`. Nothing else in the batch waits for it.

| Setting | Default | What it does |
|---|---|---|
| `presend_hook` | empty (off) | A command, or a URL. URLs must be `https://`, except `http://localhost` and `http://127.0.0.1`. |
| `presend_hook_on_error` | `hold` | What happens if the hook times out, exits non-zero, or answers with anything else: `hold` the email or `send` it anyway. |
| `presend_hook_timeout` | `10` | Seconds to wait for an answer. |

**Example: a cold-email legality check with [Precleared](https://precleared.dev).**
Precleared answers whether a cold email to a given address is allowed, and why. A
small wrapper that turns its verdict into `send` or `hold` is all it takes:

```python
#!/usr/bin/env python3
"""~/bin/precleared_hook.py: hold anything Precleared doesn't clear."""
import json, sys, urllib.request

email = json.load(sys.stdin)
req = urllib.request.Request(
    "https://api.precleared.dev/v1/check?src=openleads",
    data=json.dumps({"email": email["to"], "sender_country": "GB",
                     "company": email["lead"].get("organization", "")}).encode(),
    headers={"Content-Type": "application/json"})
verdict = json.load(urllib.request.urlopen(req, timeout=8))
ok = verdict.get("verdict") == "ok_to_email"
print(json.dumps({"action": "send" if ok else "hold", "reason": verdict.get("reason", "")}))
```

Check Precleared's own docs for its current API before relying on this sketch.
Thanks to @gabrielaoimevbore-beep, whose PR #31 started this.

## Safety defaults, in one place

- Dry-run everywhere; `--live` + confirm to send.
- `safe`-tier only unless you opt into `risky`.
- Hard daily cap + warmup ramp + human pacing.
- Permanent suppression; one-click unsubscribe; no tracking pixels.
- Per-recipient try/except, so one failure never aborts the batch.

You still own compliance (CAN-SPAM, GDPR, CASL). See
[responsible-use.md](./responsible-use.md). OpenLeads gives you the guardrails; using
them well is on you.
