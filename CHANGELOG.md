# Changelog

All notable changes to OpenLeads are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/), and the project aims for
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Roadmap items: more free sources, JSON output, caching layer.

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

[Unreleased]: https://github.com/Samyrrrrrr990/openleads/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Samyrrrrrr990/openleads/releases/tag/v0.1.0
