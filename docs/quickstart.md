# Quickstart: from zero to a sent campaign

This is the 10-minute path: install, find leads, write the emails, connect your
mailbox, and send it safely. Every sending step is **dry-run by default**.

> TL;DR: `pip install "openleads[all]"` → `openleads web` → Find people → save
> them to a list → put the list in a sequence. Or stay in the terminal with
> `openleads run`. Just looking? `openleads demo` opens the dashboard on an
> invented workspace.

---

## 1. Install

```bash
pip install "openleads[all]"     # engine + chat TUI + sending niceties
openleads --version              # → openleads 5.0.0
openleads init                   # friendly first-run setup (optional)
```

Node user? `npx openleads` works too (it installs the Python package on first run).

### Windows (PowerShell)

Install with `pipx` so OpenLeads and its Python dependencies stay in an isolated environment:

```powershell
py -m pip install --user pipx
py -m pipx ensurepath
```

Close and reopen PowerShell after `ensurepath` so the updated PATH takes effect, then install and check the CLI:

```powershell
pipx install "openleads[all]"
openleads --version
openleads init
```

PowerShell accepts double-quoted search phrases directly. Keep the phrase in one quoted argument; a variable works too:

```powershell
openleads find "marketing agencies in Miami" -n 10
$query = 'marketing agencies in Miami'
openleads find $query -n 10
```

The scheduler uses Windows Task Scheduler (not cron). Check its status before enabling it:

```powershell
openleads schedule status
openleads schedule on
openleads schedule status
openleads runs
```

Only run `schedule on` after reviewing any existing recipes and watchers: it activates due jobs, which may include sending if you previously configured them. The computer must be awake and the Windows user profile available for scheduled runs.

If you prefer not to use `pipx`, `py -m pip install --user "openleads[all]"` is an alternative; make sure your Python user Scripts directory is on PATH so PowerShell can find `openleads.exe`.

## 2. Sanity-check your setup

```bash
openleads doctor
```

`doctor` tells you, in plain language, what works and what to fix:

- **DNS-over-HTTPS** reachable? (needed for MX/SPF/DMARC checks)
- **SMTP port 25** open? If blocked (most home ISPs), don't worry: the engine
  compensates with Gravatar + ground-truth + learned patterns.
- **OpenRouter key** set? Optional; unlocks AI drafting + smarter NL parsing.
- **Mailbox** configured + logs in? Needed only for *sending*.
- Your **sending domain's** SPF/DKIM/DMARC grade.

## 3. Find leads

Just describe who you want. OpenLeads **federates** across the sources that fit
(you don't pick one):

```bash
openleads find "marketing agencies in Miami"          # local businesses + their people
openleads find "50 fintech founders, verified only"   # YC + Hacker News
openleads find "dentists in Austin"                   # clinics + registry records
```

You'll see each lead stream in with a tier and a 0–100 score:

- **`safe`**: deliverable; sent by default.
- **`risky`**: kept, but held back unless you opt in.
- **`bad`**: dropped (no MX, disposable, unguessable).

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
your **app password** (not your normal password; see your provider's docs), and your
sender identity (name, org, a few lines about what you're reaching out about).

Secrets are written to `~/.openleads/secrets.json` (`chmod 600`) and never leave your
machine. Prefer env vars / `.env`? Those still win. See [`sending.md`](./sending.md).

## 5. Write + send

One command does the whole pipeline (dry-run first, and always preview):

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

Opens `http://127.0.0.1:8787`: the same engine, in your browser, fully local — a
people and company database, lists, sequences, tasks, deals and analytics.
See [`web.md`](./web.md). To look around first without touching your own data:

```bash
openleads demo
```

## 7. Work your leads

Everything you find is saved to your workspace. Organize it, then let a sequence
do the follow-up:

```bash
openleads people --fit A --never-contacted          # your best untouched leads
openleads lists create "Q4 dentists"
openleads lists add "Q4 dentists" --where dental
openleads seq create "Q4 outbound" --pitch "We fill last-minute cancellations"
openleads seq enroll "Q4 outbound" --list "Q4 dentists"
openleads seq run "Q4 outbound"                      # dry run: what would send
openleads seq activate "Q4 outbound"                 # let the scheduler run it
openleads tasks --bucket today                       # calls and LinkedIn steps due
```

Already have a list from Apollo, HubSpot or a spreadsheet?
`openleads import export.csv --list "Imported"`. The [workspace guide](./workspace.md)
and the [sequences guide](./sequences.md) cover the rest.

## 8. Keep an eye on it

```bash
openleads stats               # contacts, sends, replies, tasks, pipeline
openleads inbox               # optional: scan IMAP for replies & bounces
openleads crm --export out.csv
```

Replies and bounces update each contact's stage and **stop** their sequences
automatically.

---

### Where things live

Everything is under `~/.openleads/` (override with `OPENLEADS_HOME`):

| File | What |
|---|---|
| `openleads.db` | your workspace: people, companies, lists, sequences, tasks, deals, notes, activity, plus touches, suppression and learned patterns |
| `cache.db` | MX / SMTP / dataset cache (speeds up re-runs) |
| `config.json` | non-secret preferences |
| `secrets.json` | API keys + mailbox credentials (`chmod 600`) |
| `sources/*.py` | your own source plugins |

Next: [Workspace](./workspace.md) · [Sequences](./sequences.md) ·
[Deliverability deep-dive](./deliverability.md) · [Sending guide](./sending.md) ·
[Web dashboard](./web.md) · [Write a source](./sources.md).
