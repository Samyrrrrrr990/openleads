# OpenLeads v2.0 — Design Spec

**Date:** 2026-06-09
**Status:** Approved (design), implementation pending
**Version target:** 2.0.0

## 1. Vision

Apollo, Hunter, RocketReach, and ZoomInfo all sell access to a large proprietary
contact database plus an email-verification feature. OpenLeads v1 reproduced the
verification feature for free, but only for one vertical (YC founders).

v2.0 **inverts the moat**. Instead of owning a database, OpenLeads becomes a
**universal `entity → verified email` engine fed by a registry of pluggable,
free, keyless public data sources.** The email engine is vertical-agnostic: any
name + any domain → a verified or honestly-scored email. Coverage therefore
scales by *adding small source plugins*, not by owning data. A contributor adds
a whole new vertical (doctors, lawyers, researchers, podcasters…) by dropping one
`.py` file into `openleads/sources/` or `~/.openleads/sources/`.

This is how OpenLeads is "Apollo for everyone" at $0.

## 2. Goals / Non-goals

**Goals**
- Proper, pip-installable Python package with a clean module layout.
- Keep the **core engine + library 100% standard-library** (zero runtime deps).
- A **chat-style interactive CLI** (Claude Code-like) that feels conversational
  and useful, works fully offline via a rule-based intent parser, and optionally
  uses a free LLM if `OPENROUTER_API_KEY` is set.
- A **pluggable source registry** with several real keyless sources across
  multiple verticals shipped in the box.
- **Confidence scoring 0–100** with multi-resolver MX cross-checks.
- **SQLite caching** to avoid re-probing domains/mailservers.
- `--format csv|json|ndjson` output.
- Professional OSS release: docs, CHANGELOG, README rewrite, GitHub release,
  PyPI publish, and an npm/npx wrapper for `npx openleads`.

**Non-goals (v2.0)**
- No hosted website / web UI (deferred; architecture leaves room for it).
- No proprietary/paid data sources, no required API keys for any core feature.
- Not trying to match Apollo's *database size* — we match its *capability* and
  make coverage community-extensible.

## 3. Package architecture

```
openleads/
  __init__.py            # version, public API re-exports
  __main__.py            # `python -m openleads` → cli.main()
  cli.py                 # argparse: find · sources · verify · cache · chat · campaign
  chat.py                # interactive REPL (rich/prompt_toolkit if available, else stdlib)
  intent.py              # rule-based NL → Query parser (+ optional LLM fallback)
  engine.py              # pipeline orchestration
  models.py              # Entity, Lead, EmailResult, Query, SourceInfo dataclasses
  config.py              # XDG paths (~/.openleads), env, optional OPENROUTER_API_KEY
  writers.py             # csv / json / ndjson writers  (single module; avoids output/ gitignore)
  emails/                # named "emails" to avoid clashing with stdlib `email`
    __init__.py
    mx.py                # DoH MX lookup across multiple resolvers
    permute.py           # name → candidate local-parts (ported + expanded)
    smtp_verify.py       # SMTP RCPT probe + catch-all detection
    resolve.py           # orchestrate + compute confidence score
  sources/
    __init__.py          # registry: discover built-ins + user plugins, name→Source
    base.py              # Source protocol/ABC + helpers
    yc.py                # YC companies + founders  (ported from v1)
    github.py            # GitHub orgs/users (keyless; optional GITHUB_TOKEN)
    producthunt.py       # ProductHunt makers via public RSS/feed (keyless)
    npi.py               # US healthcare providers (NPI Registry API, keyless)
    openalex.py          # researchers/academics (OpenAlex API, keyless)
  cache/
    __init__.py
    store.py             # sqlite3 cache: MX, SMTP, source datasets (TTLs)
  campaign.py            # ported automation.py (optional [campaign] extra)

lead_engine.py           # thin back-compat shim → openleads package (deprecation note)
npm/                     # npm wrapper package for `npx openleads`
```

**Dependency policy**
- `pip install openleads` → installs **nothing** beyond stdlib.
- `pip install openleads[chat]` → adds `rich`, `prompt_toolkit` for the pretty TUI.
- `pip install openleads[campaign]` → adds `requests`, `python-dotenv` for sending.
- `pip install openleads[dev]` → `pytest`, `ruff`.
- `chat.py` imports rich/prompt_toolkit lazily; if absent, it degrades to a
  plain `input()`/`print()` loop with identical behavior.

## 4. Data model (`models.py`)

```python
@dataclass
class Entity:                 # normalized record every source yields
    full_name: str
    title: str = ""
    organization: str = ""
    domain: str = ""          # email domain if known/derivable
    website: str = ""
    location: str = ""
    links: dict = {}          # linkedin, github, orcid, npi, etc.
    extra: dict = {}          # vertical-specific metadata
    source: str = ""

@dataclass
class EmailResult:
    email: str = ""
    confidence: str = "none"  # verified | catch_all_guess | pattern_guess | none
    score: int = 0            # 0–100
    signals: dict = {}        # which checks fired (for transparency)

@dataclass
class Lead:                   # Entity + EmailResult, flattened for output
    ...                       # superset of v1 CSV schema (back-compatible)

@dataclass
class Query:                  # parsed user intent
    action: str = "find"      # find | verify | export
    source: str | None = None
    count: int = 20
    industry: str | None = None
    location: str | None = None
    title: str | None = None
    keyword: str | None = None
    verified_only: bool = False
    fmt: str = "csv"          # csv | json | ndjson
    out: str | None = None
    max_companies: int = 400
```

## 5. Sources (plugin system)

`base.py` defines:

```python
class Source(Protocol):
    name: str            # "yc", "github", "npi", ...
    kind: str            # "company" | "people"
    description: str
    def search(self, query: Query) -> Iterator[Entity]: ...
```

- `sources/__init__.py` auto-discovers every `Source` subclass/instance in the
  built-in package **and** in `~/.openleads/sources/*.py`, building a
  `name → Source` registry. `openleads sources` lists them with descriptions.
- The engine selects a source by `query.source`, or picks a sensible default
  (yc) when the intent parser can't infer one, and asks/guides in chat mode.

**Shipped sources (all keyless):**

| name | kind | vertical | data source | notes |
|------|------|----------|-------------|-------|
| `yc` | company | startup founders | yc-oss API + YC pages | ported from v1 |
| `github` | company/people | devs & orgs | GitHub REST (unauth 60/hr) | optional `GITHUB_TOKEN` raises limit |
| `producthunt` | company | makers/products | ProductHunt public RSS | keyless; brittle-tolerant |
| `npi` | people | US doctors/providers | NPI Registry API | rich public data; emails rarely derivable |
| `openalex` | people | researchers | OpenAlex API | huge; domain via institution when available |

**Honesty for domain-less verticals:** sources like `npi` often have no email
domain. The engine still emits the full public record (name, org, taxonomy,
location, NPI) and only attempts email resolution when a domain is derivable;
confidence is labeled `none`/`pattern_guess` accordingly. We never fabricate
"verified" results.

## 6. Email engine + confidence scoring

`emails/resolve.py` produces an `EmailResult` with a **0–100 score** combining:

| signal | effect |
|--------|--------|
| MX exists | required; else score 0 / `none` |
| MX agreement across ≥2 DoH resolvers (Google + Cloudflare) | +confidence |
| SMTP `250` on a candidate (not catch-all) | → `verified`, high score |
| catch-all detected | → `catch_all_guess`, capped score |
| no SMTP reachability (port 25 blocked) | → `pattern_guess`, MX-only score |
| common pattern (`first`, `first.last`) | + small boost |
| role account (info@, admin@) / disposable domain | penalty |

`signals` dict is attached so output can explain the score. Human labels are
preserved for back-compat; `score` is additive.

## 7. Cache (`cache/store.py`)

- `~/.openleads/cache.db` via stdlib `sqlite3` (zero-dep).
- Tables/TTLs: `mx` (7d), `smtp` keyed by email (14d), `dataset` keyed by URL (1d).
- Flags: `--no-cache`, `--cache-ttl`; commands: `openleads cache info|clear`.
- Transparent: a cache hit short-circuits network probes. Big speedup on re-runs
  and politeness to mail servers.

## 8. Output (`writers.py`)

- `--format csv` (default) — identical schema to v1, consumed by `campaign.py`.
- `--format json` — array of lead objects (incl. `score`, `signals`).
- `--format ndjson` — one lead per line (streamable).
- `--out -` → stdout; otherwise a file path. Default `leads.csv`.

## 9. CLI surface

```
openleads                       # no args → launch chat
openleads chat                  # interactive REPL
openleads find [QUERY] [opts]   # one-shot: --source --count --industry --location
                                #   --title --verified-only --format --out --no-cache
openleads sources [list|info NAME]
openleads verify EMAIL [EMAIL...]
openleads cache [info|clear]
openleads campaign [opts]       # ported outreach tool (needs [campaign] extra)
```

## 10. Chat CLI (`chat.py` + `intent.py`)

A REPL that feels like Claude Code:
- Pretty TUI via `rich`+`prompt_toolkit` when installed; graceful stdlib fallback.
- **Rule-based intent parser** extracts action, source/vertical, count, filters
  (industry, location, title), verified-only, and format from free-text like
  "find 50 fintech founders verified only", "doctors in California",
  "ML researchers at MIT".
- **Slash commands** for precision: `/source npi`, `/count 50`, `/verified`,
  `/format ndjson`, `/export FILE`, `/sources`, `/cache`, `/help`, `/quit`.
- **Session state**: last result set is retained so the user can refine
  ("only verified", "export that to leads.csv") without re-running.
- Streams per-lead progress live, prettified into a table; prints a summary.
- **Optional LLM**: if `OPENROUTER_API_KEY` is set, ambiguous input is sent to a
  free model that returns a structured `Query` JSON, consumed by the same
  pipeline. Without a key, falls back to the rule parser plus one guided
  clarifying question. The active mode is always shown.

## 11. Distribution

**PyPI**
- `pyproject.toml` updated: version 2.0.0, `packages=["openleads", ...]`,
  entry point `openleads = "openleads.cli:main"`, optional extras
  `chat`/`campaign`/`dev`.
- Build with `python -m build`, upload with `twine`.

**npm / npx wrapper (`npm/`)**
- A small Node package whose `bin` shim (`openleads`) ensures the Python package
  is installed (via `pipx`/`pip --user` on first run) and forwards args to
  `python3 -m openleads`. Enables `npx openleads` / `npm i -g openleads`.
- Documented clearly as a convenience wrapper around the Python tool.

## 12. Migration & compatibility

- v1 logic ported into `openleads/`; `lead_engine.py` becomes a thin shim that
  re-exports and prints a one-line deprecation note, so old commands still work.
- CSV schema unchanged → `automation.py`/`campaign` keeps working.
- `automation.py` moved to `openleads/campaign.py` behind `[campaign]` extra; a
  shim remains at the old path.

## 13. Testing

- Network-free unit tests (fast, deterministic CI): intent parser, permutations,
  MX record parsing, confidence scoring math, writers (csv/json/ndjson), source
  registry discovery, cache get/set/TTL, plugin loading.
- Fixture-based tests for each source's parse step (saved JSON/RSS samples).
- Mock-based SMTP probe test. CI runs `ruff` + `pytest` against the package and
  smoke-tests the `openleads` entry point.

## 14. Release engineering

- README rewrite: new positioning ("Apollo for everyone"), verticals, chat demo,
  install matrix, source table, "add your own source" snippet.
- New docs: `docs/sources.md` (how to write a source plugin), updated
  `docs/architecture.md`, `docs/how-it-works.md`, and `docs/responsible-use.md`
  (explicit healthcare/doctor + researcher outreach ethics).
- `CHANGELOG.md` 2.0.0 entry. Annotated git tag `v2.0.0` + GitHub Release notes.
- PII hygiene: ensure no scraped contact CSVs are tracked (already gitignored).

## 15. Build order (incremental)

1. Package skeleton + `models.py` + `config.py` (no behavior change).
2. Port email engine → `emails/` with multi-resolver MX + scoring + tests.
3. `sources/` registry + `base.py` + port `yc.py`; plugin discovery + tests.
4. `engine.py` pipeline + `writers.py` (csv/json/ndjson) + tests.
5. `cache/store.py` + wire into mx/smtp/datasets + tests.
6. New sources: `github`, `producthunt`, `npi`, `openalex` + fixture tests.
7. `cli.py` (argparse subcommands) + `lead_engine.py` shim + entry point.
8. `intent.py` rule parser (+ optional LLM) + tests.
9. `chat.py` REPL (rich/prompt_toolkit + stdlib fallback).
10. `campaign.py` port + extra.
11. `pyproject.toml` 2.0.0 + extras; `npm/` wrapper.
12. Docs, README, CHANGELOG, tests green, ruff clean.
13. Release: build, tag `v2.0.0`, GitHub Release; print PyPI + npm publish steps.
```
