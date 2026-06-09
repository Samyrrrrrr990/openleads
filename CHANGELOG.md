# Changelog

All notable changes to OpenLeads are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/), and the project aims for
[Semantic Versioning](https://semver.org/).

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

[2.0.0]: https://github.com/Samyrrrrrr990/openleads/releases/tag/v2.0.0
[0.1.0]: https://github.com/Samyrrrrrr990/openleads/releases/tag/v0.1.0
