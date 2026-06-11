# OpenLeads v3.0 — Design Spec

**Date:** 2026-06-10
**Status:** Approved — building
**Branch:** `v3`
**Package name:** unchanged (`openleads`) — this is a reimagining, not a rebrand.

---

## 1. Vision

OpenLeads v2 is a *find + verify* tool. v3 turns it into the **complete, free, local
cold-outreach machine**: find anyone → verify deliverably → write personalized email →
send safely, in ~4 clicks, with an engine whose deliverability beats Hunter/Apollo's
free tier — for **$0**, with **zero-dependency core**, and **no data leaving the user's
machine**.

Two north stars:

1. **Deliverability that kills the competition.** The #1 v2 failure: verification relied
   almost entirely on SMTP `RCPT` over outbound **port 25**, which home ISPs and most
   clouds block. When blocked, every lead silently degraded to a `first.last@domain`
   guess → bounces. v3 replaces this with a **multi-signal consensus** that mostly needs
   no port 25 at all, and **gates honestly** so users only send to addresses likely to land.

2. **Cold email in 4 clicks.** Find → Write → Connect → Send. The painful multi-tool
   workflow (scrape → verify in tool B → enrich in tool C → load into sender D → warm up
   in E) collapses into one local app + CLI.

### Non-goals (YAGNI)
- No hosted SaaS / cloud backend (conflicts with free + no-PII). Web app is **local-first**.
- No paid APIs anywhere in the default path. Optional free LLM (OpenRouter free models)
  only for *drafting* and *NL parsing*, never required.
- No tracking pixels / open-tracking by default (hurts deliverability, creepy).
- No CRM integrations with external services in v3 (local SQLite CRM only).

---

## 2. Architecture

Restructure the flat `openleads/` package into bounded subpackages. Each unit has one
purpose, a small interface, and is independently testable. **Back-compat is preserved**:
old import paths (`openleads.engine`, `openleads.campaign`, `openleads.sources`,
`openleads.emails`) keep working via thin shim modules, and the v2 CSV schema is unchanged.

```
openleads/
  core/
    models.py        # Entity, EmailResult, Lead, Query, Draft, Campaign, SendResult
    config.py        # paths, USER_AGENT, home() (kept; extended)
    settings.py      # NEW: persistent, CLI-writable settings + secret store
  discover/          # (was sources/) — find entities from free public data
    base.py, __init__ (registry), yc, github, npi, openalex, producthunt
    crunchbase_news? (NO — keep to free/keyless). NEW free sources: hackernews, rss/blog, domain
  verify/            # (was emails/) — the deliverability engine
    permute.py       # candidate generation (expanded pattern set + priors)
    mx.py            # MX over DoH + SPF/DMARC/MX-provider classification
    smtp_probe.py    # greylist-aware, multi-host, catch-all double-probe
    gravatar.py      # NEW free existence signal (no port 25)
    groundtruth.py   # NEW harvest real emails (github commits, mailto, security.txt)
    patterns.py      # NEW per-domain learned patterns + global priors
    score.py         # consensus score -> tier (safe|risky|bad), explainable
    resolve.py       # orchestrator (find_email, verify_address)
  outreach/          # (was campaign.py) — the sending engine
    compose.py       # LLM drafting (free) + templates + spam linter + personalization
    providers.py     # SMTP presets (Gmail/Workspace, Outlook/M365, generic), app-pw
    deliverability.py# sender-side preflight: SPF/DKIM/DMARC of YOUR domain + warmup plan
    sender.py        # throttled send, suppression, List-Unsubscribe, headers, logging
    sequences.py     # multi-step follow-ups; stop-on-reply / stop-on-bounce
    inbox.py         # OPTIONAL IMAP read-back: detect bounces + replies
  automate/          # NEW local automations
    pipeline.py      # find -> verify -> write -> send, one call (the 4-click backend)
    crm.py           # SQLite CRM: leads + touches + status; queries
    dedupe.py        # cross-run dedupe + do-not-contact
    scheduler.py     # drip loop + cron/launchd snippet generator
    templates.py     # template library + A/B subject selection
  cli/
    main.py          # argparse: find, verify, sources, write, send, run, config, doctor, web, crm, cache, chat
    chat.py          # the REPL (extended with write/send verbs)
    config_cmd.py    # `openleads config` interactive + set/get/list
    doctor.py        # environment + deliverability self-check
  web/               # NEW local-first dashboard
    server.py        # stdlib http.server (ThreadingHTTPServer): JSON API + static files
    api.py           # request handlers bridging to engine
    static/          # PRE-BUILT React app (committed build output; no Node needed by user)
  store/
    cache.py         # (was cache/store.py) sqlite cache
    db.py            # NEW shared sqlite: leads, campaigns, suppression, patterns, state
  ui.py, writers.py, intent.py  # kept, extended
web-src/             # React+Vite+Tailwind+Framer SOURCE (dev-only; builds into web/static)
site/                # NEW GitHub Pages marketing landing (static, animated)
.github/workflows/   # CI + release (PyPI + npm) automation
```

### Optional dependency extras (`pyproject.toml`)
- core: **zero deps** (engine, verify, sender, web server all stdlib).
- `chat`: `rich`, `prompt_toolkit` (pretty TUI).
- `outreach`: `requests`, `python-dotenv` (LLM drafting convenience; SMTP/IMAP are stdlib).
- `web`: nothing extra (stdlib server) — extra exists only to pull `chat` niceties.
- `all`, `dev` as today.

---

## 3. The deliverability engine (`verify/`)

### 3.1 Signals (all free)
| Signal | Needs port 25? | Source |
|---|---|---|
| MX exists + multi-resolver agreement | no | DoH (Google+Cloudflare), v2 |
| SPF present, DMARC present, MX provider class | no | DoH TXT lookups |
| Disposable / role / free-provider | no | static lists |
| **Gravatar existence** (md5 → HTTP 200/404) | no | gravatar.com |
| **Ground-truth real email** (exact) | no | GitHub commits API, `mailto:`/`security.txt` scrape, source-provided public emails |
| **Learned domain pattern** match | no | patterns cache (built from ground truth) |
| SMTP `RCPT` accept + **catch-all double-probe** + greylist retry | **yes** (graceful when blocked) | mail server |

### 3.2 Scoring → tiers
`score.py` is a **pure function** `signals -> {score:0-100, tier, confidence, reasons[]}`.
Tiers:
- **safe** — emit + send by default. Triggers: ground-truth exact match; OR SMTP-verified
  (non-catch-all); OR (learned-pattern match AND Gravatar hit AND MX healthy AND not catch-all);
  OR (Gravatar hit AND common pattern AND SPF/DMARC healthy).
- **risky** — keep but **don't send by default**. Catch-all domains, pattern-only guesses,
  port-25-blocked-without-corroboration, role-ish.
- **bad** — drop. No MX, disposable, invalid syntax.

`confidence` keeps v2 labels (`verified`/`catch_all_guess`/`pattern_guess`/`none`) for
back-compat; `tier` + `reasons[]` are new and drive UX ("why is this safe?").

### 3.3 Pattern learning
`patterns.py` maintains, per domain, the observed local-part shape(s) derived from any
ground-truth email (e.g. `ada@acme.ai` → pattern `{first}`). Stored in `store/db.py`
(`patterns` table) so it persists and compounds across runs. When resolving a new person at
a known domain, the learned pattern is tried first and, on a corroborating signal, promotes
the guess to **safe**. Global prior frequencies order candidates when nothing is learned.

### 3.4 Ground-truth harvesting
`groundtruth.py` exposes `harvest(domain, full_name=None) -> list[str]` combining:
- GitHub commits: for a person with a github link, read public commit author emails
  (filtered to non-`noreply`); for a domain, search users/orgs. Exact personal emails.
- Site scrape: fetch `https://domain`, `/security.txt`, `/.well-known/security.txt`,
  `/contact` and extract `mailto:`/regex emails on that domain.
- Source-provided: emails a discover source already attached (e.g. GitHub public email).
Harvested emails feed both direct verification (exact match = safe) and pattern learning.

### 3.5 SMTP probe hardening
- Try up to 2 MX hosts; reuse one connection for catch-all probe + candidates.
- **Catch-all double-probe** (two random locals) to avoid false catch-all flags.
- **Greylist handling**: on `4xx`, brief retry once.
- Timeouts + politeness delays as v2; graceful `reachable:false` when port 25 blocked.

---

## 4. The sending engine (`outreach/`) — "4 clicks"

### Flow
1. **Find** — engine yields `safe` leads (and `risky`, hidden by default).
2. **Write** — `compose.py` drafts per-lead subject+body via a free LLM (OpenRouter free
   model) using lead facts; falls back to a deterministic template when no key. Output is
   **spam-linted** (spammy-word score, link count, caps ratio, length), placeholder-free,
   plain-text-first. User can edit any draft.
3. **Connect** — one-time mailbox setup via `providers.py` presets (Gmail/Workspace,
   Outlook/M365, generic SMTP/SSL/STARTTLS) using an **app password** (documented per
   provider). `deliverability.py` runs a **sender preflight** on the From domain: SPF,
   DKIM (selector probe / advisory), DMARC, MX — and returns a readiness score + fixes.
   Also computes a **warmup plan** (start N/day, ramp, daily cap).
4. **Send** — `sender.py`:
   - Honors warmup cap + randomized human-like delays + send window (recipient-friendly hours).
   - Skips anyone on the **suppression list** (bounced/unsubscribed/replied/do-not-contact/dupe).
   - Adds `List-Unsubscribe` + `List-Unsubscribe-Post` (one-click) headers and a footer
     unsubscribe line; proper `Message-ID`, `Date`, threading headers.
   - Plain-text default (optional minimal HTML alt). **No open-tracking pixels.**
   - Writes every send to `store/db.py` (`campaigns`, `touches`); fully resumable.
5. **Follow up** — `sequences.py` schedules step 2..N; `inbox.py` (optional IMAP) detects
   replies/bounces and **stops** the sequence + updates suppression.

### Safety defaults
- **Dry-run by default** everywhere; sending requires an explicit `--live` / confirm.
- Hard daily cap; refuse to send to non-`safe` unless `--include-risky`.
- Sender preflight failures warn loudly (this is why cold email hits spam).

---

## 5. In-CLI configuration (`core/settings.py`, `cli/config_cmd.py`, `cli/doctor.py`)

- `openleads config` → interactive menu to set: OpenRouter key + model, GitHub token,
  SMTP provider/user/app-password, sender name/org/context, sending limits, verify options.
- `openleads config set KEY VALUE` / `get KEY` / `list` (secrets masked).
- Storage: non-secret settings in `~/.openleads/config.toml`; secrets in
  `~/.openleads/secrets.json` (chmod `0600`) — never in git. Env vars + `.env` still win if set
  (precedence: explicit env > secrets store > config.toml > defaults).
- `openleads doctor` → checks: Python, optional extras, network, port 25 reachability,
  configured mailbox login, sender SPF/DMARC, free-LLM key — prints actionable status.

---

## 6. Local automations (`automate/`)

- `openleads run "<query>"` → full **pipeline**: find → verify(safe) → write → (dry-run)
  send, with a single confirm to go live. This is the CLI form of the 4 clicks.
- **CRM** (`crm.py` + `store/db.py`): every lead + every touch + status (new/queued/sent/
  replied/bounced/unsub). `openleads crm` lists/filters; web has a CRM page.
- **Dedupe + do-not-contact**: never re-surface or re-email the same address across runs.
- **Scheduler**: `openleads run --daily` foreground drip loop; `openleads schedule install`
  emits a cron/launchd snippet for hands-off daily sends.
- **Templates + A/B**: named templates; alternate subject lines, pick per-lead.

---

## 7. Local-first web app (`web/`, `web-src/`)

- `openleads web` → starts `ThreadingHTTPServer` on `127.0.0.1:8787` (configurable),
  opens the browser. **Stdlib only** — no new Python deps.
- `api.py` exposes JSON endpoints bridging to the same engine the CLI uses:
  `POST /api/find`, `/api/verify`, `/api/write`, `/api/send` (SSE/stream for progress),
  `GET/POST /api/settings`, `/api/crm`, `/api/doctor`, `/api/sources`.
- Frontend in `web-src/` (React + Vite + TypeScript + Tailwind + Framer Motion),
  **pre-built** into `web/static/` and committed, so end users need **no Node**.
  Pages: **Find**, **Leads** (tiered table + filters + why-safe), **Compose**,
  **Send/Campaigns** (warmup, live status), **CRM**, **Settings**, **Doctor**.
  Design per frontend-design + web-animation-design skills: distinctive, polished, animated,
  `prefers-reduced-motion` respected. The "4 clicks" is the primary on-screen path.
- Security: binds to localhost only; CSRF-safe (same-origin); secrets never sent to the
  browser in plaintext beyond what the user typed; clear "runs locally" banner.

---

## 8. Marketing site (`site/`)

Static, animated GitHub Pages landing (no framework needed; hand-built HTML/CSS/JS or a tiny
Vite build). Sections: hero ("Apollo-grade leads + cold email. Free. Local."), the 4-click
demo (animated), live terminal/asciinema-style demo, vs-Apollo/Hunter comparison, "host it
yourself in 10s" install block, deliverability explainer, OSS/credibility, footer. Deployed
via GitHub Pages (Actions or `/docs`-style). Honors reduced-motion.

---

## 9. Professional OSS release

- **Restructure** with back-compat shims; keep all 94+ v2 tests green; add tests for every
  new module (network mocked / pure functions). Target: tests stay network-free and fast.
- **Docs**: rewrite README (v3 story, screenshots/gif, 4-click flow, deliverability section,
  comparison), `CHANGELOG.md` (v3.0.0), `docs/` updates (architecture, deliverability,
  sending, web, responsible-use incl. CAN-SPAM/GDPR cold-email ethics), MIGRATION note.
- **CI**: lint (ruff) + tests + build on PRs (existing workflow extended).
- **Release automation**: workflows to build wheel/sdist and publish to **PyPI** (trusted
  publishing or token) and **npm** on tag `v3.0.0`. Bump versions to `3.0.0`.
- **GitHub**: commit on branch `v3`, open PR, (merge per user), tag + GitHub Release with notes.
- **Publishing caveat**: GitHub push is authorized + revertible and will be done. The final
  PyPI `twine upload` / `npm publish` are irreversible public actions → left to the user with
  their tokens (one-command trigger documented + automated-on-tag).

---

## 10. Data flow (end to end)

```
Query ─▶ discover.Source.search() ─▶ Entity stream
                                        │
                         verify.resolve.find_email(entity)
                          ├ groundtruth.harvest → exact match?  ──▶ safe
                          ├ patterns.learned(domain) + gravatar + mx/spf/dmarc
                          └ smtp_probe (if port 25) ─▶ score.tier()
                                        │
                                   Lead{tier, score, reasons}
                                        │  (safe by default)
                         outreach.compose.draft(lead) ─▶ Draft{subject, body}
                                        │  (spam-linted, editable)
                         outreach.deliverability.preflight(sender) ─▶ readiness + warmup
                                        │
                         outreach.sender.send(draft, lead) ─▶ SendResult ─▶ store/db (CRM)
                                        │
                         outreach.sequences / inbox ─▶ follow-ups, stop-on-reply/bounce
```

Same path is invoked by CLI commands, the chat REPL, and the web API.

---

## 11. Error handling

- Network/source failures degrade gracefully (skip entity, continue), never crash a run.
- Verification: any signal error → treat as absent, never as a false positive (bias toward
  *not* marking safe).
- Sending: per-recipient try/except; one failure never aborts the batch; all outcomes logged
  and resumable; SMTP auth failure surfaces a clear provider-specific hint.
- Web: every endpoint returns structured JSON errors; server never leaks secrets in errors.
- Config: missing/invalid secrets produce actionable `doctor` guidance, not tracebacks.

---

## 12. Testing strategy

- Pure functions (scoring, permutation, pattern derivation, spam-lint, parsing, warmup math,
  header building, suppression logic) unit-tested directly, network-free.
- Network adapters (mx, smtp_probe, gravatar, groundtruth, providers, inbox) tested via
  injected fakes / fixtures; no live network in CI.
- Web API tested against an in-process server with a stubbed engine.
- Back-compat: a test asserts old import paths + v2 CSV schema still work.
- Keep the suite fast and deterministic (the v2 standard).

---

## 13. Implementation order (built in one effort, sequenced for safety)

1. `store/db.py` + `core/settings.py` + `core/models.py` extensions (foundation).
2. `verify/` overhaul: gravatar, groundtruth, patterns, mx (SPF/DMARC), smtp_probe, score,
   resolve + tests. **(the headline; do first, it fixes bounces)**
3. `discover/` rename + shims + new sources + tests.
4. `outreach/`: compose, providers, deliverability, sender, sequences, inbox + tests.
5. `automate/`: pipeline, crm, dedupe, scheduler, templates + tests.
6. `cli/`: restructure, config, doctor, new verbs; chat extensions + tests.
7. `web/`: server + api; `web-src/` React app; build into `web/static/`.
8. `site/`: marketing landing.
9. Docs, CHANGELOG, README, version bump 3.0.0, CI + release workflows.
10. Push branch, PR, tag/release prep; hand off PyPI/npm publish trigger.

Each step keeps the suite green before moving on.
