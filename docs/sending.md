# Sending — cold email that lands, safely

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
  weak — push toward `p=quarantine`).

Missing pieces are the #1 reason cold email hits spam. `doctor` and the web Send page
both surface the grade + exact fixes.

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

1. **Suppression check** — skips anyone bounced / unsubscribed / replied /
   do-not-contact / duplicate. The suppression list is permanent and local.
2. **Warmup check** — stops at the day's allowance.
3. **Human pacing** — a randomized delay (`send_delay_min`–`send_delay_max` seconds,
   default 25–90) between real sends.
4. **Proper headers** — `Message-ID`, `Date`, threading headers, and
   **`List-Unsubscribe` + `List-Unsubscribe-Post`** (one-click). Plain-text default;
   **no open-tracking pixels**.
5. **Logged + resumable** — every attempt is written to the local CRM (`touches`), so
   a crashed batch resumes cleanly and reporting is exact.

By default OpenLeads sends **only to `safe`-tier** addresses. Opt into `risky` with
the `include_risky` setting (off is safer).

## 5. Drafting

`outreach/compose.py` writes each email from the lead's facts:

- With `OPENROUTER_API_KEY` set, a **free LLM** drafts a personalized subject + body
  (retried until placeholder-free).
- Without a key, a **deterministic template** is used.

Either way the draft is **spam-linted** (spammy-word score, link count, caps ratio,
length) and stripped of stray placeholders and em-dash tells. You can edit any draft
before sending — in the web Compose page, your edits are exactly what's sent.

## 6. Follow-ups & reply detection

`outreach/sequences.py` schedules steps 2..N; `outreach/inbox.py` (optional IMAP)
detects replies and bounces and **stops** the sequence, updating suppression. Run:

```bash
openleads inbox --days 21
```

## 7. Commands

```bash
openleads run  "<query>"          # find → write → send (dry-run)
openleads run  "<query>" --live   # …for real
openleads send "<query>" --live   # same pipeline, terse output
openleads write "<query>" -o drafts.json   # stop after drafting
```

## Safety defaults, in one place

- Dry-run everywhere; `--live` + confirm to send.
- `safe`-tier only unless you opt into `risky`.
- Hard daily cap + warmup ramp + human pacing.
- Permanent suppression; one-click unsubscribe; no tracking pixels.
- Per-recipient try/except — one failure never aborts the batch.

You still own compliance (CAN-SPAM, GDPR, CASL) — see
[responsible-use.md](./responsible-use.md). OpenLeads gives you the guardrails; using
them well is on you.
