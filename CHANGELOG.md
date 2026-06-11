# Changelog

All notable changes to OpenLeads are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/), and the project aims for
[Semantic Versioning](https://semver.org/).

## [3.1.0] - 2026-06-11

**Better leads, and they actually show up.** v3.0 shipped the engine; v3.1 fixes
the thing that matters most — lead *quality and speed*. Previously only the YC
source reliably produced emailable leads, the others quietly returned nothing, and
a search could grind for minutes before coming up empty.

### Added
- **New source: `hn` — Hacker News "Who is hiring?"** The monthly thread is a
  goldmine of companies hiring *right now*, posted as `Company | Role | …` with a
  link and, very often, a **direct apply email**. Those emails are ground truth →
  promoted to `safe` for free; the links give a real company domain. Keyless via
  the Algolia API, one batch call, sub-second. This is the new flagship for
  current, contactable B2B/tech leads.

### Changed
- **GitHub source rebuilt for quality.** It now filters hard for *real, contactable
  developers* — a person-looking name plus a usable domain (public profile email →
  ground truth, or a real personal/company site; social and blog-platform hosts are
  rejected). Profiles are fetched concurrently (no more one-by-one + sleeps). Far
  fewer junk/topic/org accounts, far higher hit rate.
- **Engine is concurrent, fast-failing, and honest.** Email resolution runs in
  parallel windows (a batch of MX/SMTP probes overlaps instead of blocking one at a
  time), the scan **bails early** when a source can't satisfy the query (with a
  clear message instead of a multi-minute silent wait), and underlying HTTP
  failures are **surfaced** (e.g. "github returned HTTP 403 — set GITHUB_TOKEN")
  instead of vanishing. Default HTTP timeout dropped 60s → 15s.
- **Ground-truth resolution works for company-only leads.** A source-provided real
  address (HN apply email, GitHub public email) now short-circuits to `safe` even
  when there's no person name to permute — and a *published* role address
  (`jobs@`, `careers@`) stays `safe` (it's the intended contact mailbox).
- **OpenAlex** filters out concept/topic "authors" and only emits researchers with
  an institution domain. **NPI/ProductHunt** no longer cause hangs (the engine
  fast-marks domain-less records).
- **Cache/DB are thread-safe** (shared safely across the new resolver threads).

### CLI redesign
- A proper **ASCII-art `OpenLeads` banner**, ANSI color, tier-colored results with
  score meters, a proportional summary bar, and a clean `sources` listing. Color
  auto-disables off-TTY / under `NO_COLOR`; force it with `FORCE_COLOR=1`.

## [3.0.0] - 2026-06-11

**The ultimate update.** v2 found and verified leads. v3 becomes the complete,
free, local cold-outreach machine: **find → verify → write → send**, in four
clicks, with a deliverability engine that beats Hunter & Apollo's free tier — for
**$0**, with a **zero-dependency core**, and **nothing leaving your machine**.

### Added
- **Multi-signal deliverability engine** (`openleads/emails/`). Seven independent,
  mostly port-25-free signals — MX consensus (two DoH resolvers), SPF/DMARC +
  provider class, disposable/role/free filtering, **Gravatar existence**,
  **ground-truth harvesting** (real emails from GitHub commits, `mailto:` and
  `security.txt`), **learned per-domain patterns**, and a greylist-aware SMTP
  `RCPT` probe with **catch-all double-probe**. Pure-function scoring maps signals
  to a 0–100 score and an honest **tier** — `safe` / `risky` / `bad` — with a
  human-readable `reasons[]` list. This fixes v2's silent-bounce failure when
  port 25 is blocked.
- **Sending engine** (`openleads/outreach/`): personalized, spam-linted,
  plain-text-first drafts (free LLM or template); SMTP **provider presets**
  (Gmail/Workspace, Outlook/M365, Zoho, custom) with app passwords; a **sender
  preflight** that grades your SPF/DKIM/DMARC; throttled, **warmup-capped**,
  **suppression-aware** sending with `List-Unsubscribe` headers and **no tracking
  pixels**; multi-step **follow-up sequences** that stop on reply/bounce; optional
  IMAP read-back.
- **The pipeline** (`openleads run "<query>"`): find → verify → write → send in one
  command (dry-run by default; `--live` to send). The CLI form of the four clicks.
- **Local CRM + state** (`openleads/db.py`): every lead, touch, and status in a
  local SQLite file; cross-run **dedupe** and **do-not-contact**; learned patterns
  that compound across runs. `openleads crm` to view/export.
- **In-app configuration** (`openleads config`, `openleads/settings.py`): set keys,
  mailbox, sender identity, and sending policy without editing dotfiles. Secrets
  stored `chmod 600`; env > store > default precedence. **`openleads doctor`** is a
  one-command health check for finding *and* sending (incl. port-25 reachability and
  your sending domain's SPF/DKIM/DMARC).
- **Local-first web dashboard** (`openleads web`): a stdlib `ThreadingHTTPServer`
  bound to localhost serving a hand-built single-page app — **no Node, no build, no
  cloud**. Find/Leads/Compose/Send/CRM/Settings/Doctor, with the four-click path
  front and centre and **live-streaming** results. Black-and-white, hints of red;
  reduced-motion aware; nothing leaves your machine.
- **Marketing site** (`site/`) + GitHub Pages deploy, and a release workflow that
  publishes to **PyPI** and **npm** on tag.
- New in-depth guides: [`docs/deliverability.md`](./docs/deliverability.md),
  [`docs/sending.md`](./docs/sending.md), [`docs/web.md`](./docs/web.md),
  [`docs/quickstart.md`](./docs/quickstart.md).

### Changed
- CLI gains `run`, `write`, `send`, `inbox`, `crm`, `config`, `doctor`, and `web`
  verbs; the chat REPL can now write and send too. Bumped to **3.0.0**.
- CSV schema gains an `Email Tier` column (appended — v1/v2 consumers keep working).

### Backward compatibility
- All v2 import paths and the CSV schema are preserved. The full v2 test suite stays
  green; new modules add coverage (network mocked / pure functions).

## [2.0.0] - 2026-06-09

A ground-up reshape: OpenLeads goes from a single YC script to a pip-installable,
extensible **"Apollo for everyone"** with an interactive chat CLI.

### Added
- **Installable package + `openleads` CLI** with subcommands: `find`, `sources`,
  `verify`, `cache`, `chat`, `campaign`. Available via `pip install openleads` and
  `npx openleads` (thin Node wrapper in `npm/`).
- **Interactive chat REPL** (`openleads chat`, or just `openleads`) — a
  Claude-Code-style front door. Plain-English requests, conversational refinement
  ("only verified", "export to x.ndjson"), slash commands, and live result tables.
  Pretty TUI via the `[chat]` extra (`rich` + `prompt_toolkit`), with a graceful
  stdlib fallback.
- **Natural-language intent parser** (`intent.py`) — rule-based and **keyless** by
  default; optionally upgraded by a free LLM when `OPENROUTER_API_KEY` is set.
- **Pluggable source registry.** Sources auto-discover from the package **and** from
  `~/.openleads/sources/*.py` — add a whole vertical by dropping in one file.
- **New keyless sources:** `github` (developers/orgs), `npi` (U.S. doctors &
  healthcare providers), `openalex` (researchers/academics), `producthunt`
  (trending products). `yc` (founders) ported from v1.
- **Confidence scoring (0–100)** with explainable `signals`, built on
  **multi-resolver MX cross-checks** (Google + Cloudflare) plus role-account and
  disposable-domain penalties.
- **SQLite caching layer** (`~/.openleads/cache.db`) for MX (7d), SMTP results
  (14d), and source datasets (1d). `--no-cache`, `openleads cache info|clear`.
- **`--format csv|json|ndjson`** output (`--out -` for stdout). JSON/NDJSON include
  the score and signals.
- New docs: [`docs/sources.md`](./docs/sources.md) (write a source plugin); updated
  architecture, how-it-works, and responsible-use (sensitive-vertical ethics).

### Changed
- Engine, email logic, and people/company discovery moved into the `openleads`
  package (`emails/`, `sources/`, `engine.py`, …).
- Cold-email companion generalized and moved to `openleads.campaign` (configurable
  via env; no longer hardcoded to one campaign). Behind the `[campaign]` extra.
- CSV schema extended with `Email Score`, `Source`, `Vertical` (appended, so it
  stays backward-compatible with v1 consumers).

### Backward compatibility
- `lead_engine.py` and `automation.py` remain as thin shims that forward to the
  new package and re-export the v1 public helpers, so existing scripts keep working
  (with a one-line deprecation note).

## [0.1.0] - 2026-06-08

### Added
- **Lead engine** (`lead_engine.py`): a free, keyless, four-stage pipeline.
  - Company discovery via the `yc-oss` public API (~6,000 YC startups).
  - People discovery by extracting founders from public YC company pages.
  - Email engine: DNS-over-HTTPS MX lookup, name permutations, and live SMTP
    `RCPT` verification with catch-all detection.
  - CSV output with a per-lead confidence label (`verified` / `catch_all_guess` /
    `pattern_guess`).
  - CLI flags: `--count`, `--industry`, `--max-companies`, `--verified-only`,
    `--no-write`, `--out`.
- **Cold-email companion** (`automation.py`): LLM-drafted, personalized outreach with
  clean formatting, placeholder guards, Unicode normalization, SMTP sending, and
  IMAP "save to Sent".
- Full project scaffolding: docs, tests, CI, issue/PR templates, license.

[3.1.0]: https://github.com/Samyrrrrrr990/openleads/releases/tag/v3.1.0
[3.0.0]: https://github.com/Samyrrrrrr990/openleads/releases/tag/v3.0.0
[2.0.0]: https://github.com/Samyrrrrrr990/openleads/releases/tag/v2.0.0
[0.1.0]: https://github.com/Samyrrrrrr990/openleads/releases/tag/v0.1.0
