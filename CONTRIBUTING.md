# Contributing to OpenLeads

First off — thank you! OpenLeads gets better every time someone adds a new free data
source or sharpens the email engine. This doc keeps contributions smooth.

## Ground rules

- Be kind. See the [Code of Conduct](./CODE_OF_CONDUCT.md).
- The **core engine stays dependency-free** (Python standard library only). If you
  need a third-party package, it belongs in the optional `campaign` extra, not the engine.
- Keep functions small and single-purpose. The pipeline is intentionally readable.
- Build for **responsible use** — no features designed for spam, scraping behind logins,
  or evading rate limits.

## Getting set up

```bash
git clone https://github.com/Samyrrrrrr990/openleads.git
cd openleads
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev,campaign]"
pytest          # run tests
ruff check .    # lint
```

The lead engine runs with zero install:

```bash
python3 lead_engine.py --count 5 --no-write
```

## Ways to contribute

- **New free sources** — add a company or people source (GitHub orgs, ProductHunt,
  public registries). Keep it keyless and ToS-friendly.
- **Email engine** — better permutation patterns, multi-MX cross-checks, smarter
  catch-all handling.
- **Output formats** — JSON/NDJSON, CRM-specific exports.
- **Docs & examples** — always welcome.

## Pull request checklist

- [ ] Tests pass (`pytest`) and lint is clean (`ruff check .`)
- [ ] New pure functions have a unit test (no network in tests, please)
- [ ] No secrets, real emails, or scraped PII committed
- [ ] Core engine still imports with **no third-party deps**
- [ ] Updated `README.md` / `CHANGELOG.md` if behavior changed

## Commit style

Conventional-ish is appreciated but not enforced: `feat:`, `fix:`, `docs:`, `refactor:`.

## Reporting bugs / ideas

Use the [issue templates](https://github.com/Samyrrrrrr990/openleads/issues/new/choose).
For anything security-related, see [SECURITY.md](./SECURITY.md).
