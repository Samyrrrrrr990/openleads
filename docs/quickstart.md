# Quickstart — from zero to a sent campaign

This is the 10-minute path: install, find leads, write the emails, connect your
mailbox, and send — safely. Every sending step is **dry-run by default**.

> TL;DR: `pip install "openleads[all]"` → `openleads web` → click through Find →
> Write → Connect → Send. Or stay in the terminal with `openleads run`.

---

## 1. Install

```bash
pip install "openleads[all]"     # engine + chat TUI + sending niceties
openleads --version              # → openleads 4.0.0
openleads init                   # friendly first-run setup (optional)
```

Node user? `npx openleads` works too (it installs the Python package on first run).

## 2. Sanity-check your setup

```bash
openleads doctor
```

`doctor` tells you, in plain language, what works and what to fix:

- **DNS-over-HTTPS** reachable? (needed for MX/SPF/DMARC checks)
- **SMTP port 25** open? If blocked (most home ISPs), don't worry — the engine
  compensates with Gravatar + ground-truth + learned patterns.
- **OpenRouter key** set? Optional; unlocks AI drafting + smarter NL parsing.
- **Mailbox** configured + logs in? Needed only for *sending*.
- Your **sending domain's** SPF/DKIM/DMARC grade.

## 3. Find leads

Just describe who you want — OpenLeads **federates** across the sources that fit
(you don't pick one):

```bash
openleads find "marketing agencies in Miami"          # local businesses + their people
openleads find "50 fintech founders, verified only"   # YC + Hacker News
openleads find "dentists in Austin"                   # clinics + registry records
```

You'll see each lead stream in with a tier and a 0–100 score:

- **`safe`** — deliverable; sent by default.
- **`risky`** — kept, but held back unless you opt in.
- **`bad`** — dropped (no MX, disposable, unguessable).

Company results are expanded into **real people** (founder/owner/exec) via
team-page discovery. Pin a single source with `--source` (`openleads sources`
lists them), add `--deep` for heavier ground-truth harvesting, or `--no-people`
to keep company-level results only. See [Finding & the federation](./finding.md).

**Already have a list?** Enrich it instead of searching:

```bash
openleads enrich my_list.csv -o enriched.csv   # name/company/domain/email → verified
```

## 4. Connect your mailbox (once)

```bash
openleads config
```

Interactive setup for your provider (Gmail/Workspace, Outlook/M365, Zoho, or custom),
your **app password** (not your normal password — see your provider's docs), and your
sender identity (name, org, a few lines about what you're reaching out about).

Secrets are written to `~/.openleads/secrets.json` (`chmod 600`) and never leave your
machine. Prefer env vars / `.env`? Those still win. See [`sending.md`](./sending.md).

## 5. Write + send

One command does the whole pipeline (dry-run first — always preview):

```bash
openleads run "50 AI founders in SF"          # preview drafts + sends
openleads run "50 AI founders in SF" --live   # actually send
```

Or do it in pieces:

```bash
openleads write "10 AI founders" -o drafts.json   # just draft
openleads send  "10 AI founders" --live           # find → write → send
```

Sending honors your **warmup ramp** and **daily cap**, paces sends with human-like
delays, skips anyone on your **suppression list**, and adds one-click unsubscribe
headers. No tracking pixels, ever.

## 6. Prefer a UI?

```bash
openleads web
```

Opens `http://127.0.0.1:8787` — the same engine, in your browser, fully local.
See [`web.md`](./web.md).

## 7. Manage what you've done

```bash
openleads crm                 # leads + touches + status, locally in SQLite
openleads crm --export out.csv
openleads inbox               # optional: scan IMAP for replies & bounces
```

Replies and bounces update status and **stop** follow-up sequences automatically.

---

### Where things live

Everything is under `~/.openleads/` (override with `OPENLEADS_HOME`):

| File | What |
|---|---|
| `openleads.db` | leads, touches, suppression, learned patterns, campaigns |
| `cache.db` | MX / SMTP / dataset cache (speeds up re-runs) |
| `config.json` | non-secret preferences |
| `secrets.json` | API keys + mailbox credentials (`chmod 600`) |
| `sources/*.py` | your own source plugins |

Next: [Deliverability deep-dive](./deliverability.md) · [Sending guide](./sending.md) ·
[Web dashboard](./web.md) · [Write a source](./sources.md).
