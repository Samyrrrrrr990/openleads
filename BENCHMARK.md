# OpenLeads live benchmark — v5.1.1 · 2026-11-01

13 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 13/13
- **Fill rate:** 78% of requested leads returned
- **Evidence-backed emails:** 68% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 0% of people failed the person-name check
- **Median time per query:** 51.6s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds | Notes |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| dentists in Austin | 8 | 3 | 8 | 0 | 0 | 0 | 48.2 | local: degraded — overpass-api.de: timed out |
| marketing agencies in Miami | 10 | 8 | 4 | 0 | 6 | 0 | 51.6 |  |
| law firms in London | 6 | 1 | 5 | 1 | 0 | 0 | 60.0 | edgar: failed — www.sec.gov: HTTP 403 (rate-limited or forbidden) |
| accountants in Toronto | 7 | 3 | 5 | 2 | 0 | 0 | 42.2 | local: degraded — overpass→nominatim (all mirrors paused after recent failures) |
| software companies in Berlin | 10 | 1 | 9 | 0 | 1 | 0 | 60.1 |  |
| gyms in Sydney | 10 | 6 | 7 | 0 | 3 | 0 | 46.7 |  |
| fintech founders | 4 | 3 | 1 | 0 | 3 | 0 | 38.0 | yc: empty |
| AI startup founders | 10 | 4 | 6 | 0 | 4 | 0 | 28.9 |  |
| rust developers in Berlin | 10 | 10 | 8 | 0 | 2 | 0 | 51.7 |  |
| machine learning researchers | 10 | 10 | 0 | 0 | 10 | 0 | 54.9 |  |
| emails at stripe.com | 3 | 3 | 1 | 2 | 0 | 0 | 5.4 | sources ran out of results |
| real estate agents in Chicago | 5 | 3 | 5 | 0 | 0 | 0 | 52.8 | local: degraded — overpass-api.de: timed out |
| plumbers in Denver | 8 | 3 | 5 | 0 | 3 | 0 | 60.2 | local: timeout — overpass-api.de: timed out |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
