# OpenLeads live benchmark — v5.2.0 · 2026-11-06

13 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 13/13
- **Fill rate:** 89% of requested leads returned
- **Evidence-backed emails:** 71% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 0% of people failed the person-name check
- **Median time per query:** 41.8s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds | Notes |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| dentists in Austin | 10 | 4 | 7 | 0 | 3 | 0 | 54.4 |  |
| marketing agencies in Miami | 10 | 8 | 4 | 0 | 6 | 0 | 46.6 |  |
| law firms in London | 10 | 7 | 7 | 0 | 3 | 0 | 41.8 |  |
| accountants in Toronto | 6 | 3 | 3 | 0 | 3 | 0 | 27.5 | local: degraded — overpass→nominatim (all mirrors paused after recent failures) |
| software companies in Berlin | 10 | 0 | 10 | 0 | 0 | 0 | 24.8 |  |
| gyms in Sydney | 10 | 1 | 10 | 0 | 0 | 0 | 38.8 |  |
| fintech founders | 6 | 3 | 3 | 0 | 3 | 0 | 25.3 | yc: empty |
| AI startup founders | 10 | 4 | 9 | 0 | 1 | 0 | 60.0 |  |
| rust developers in Berlin | 10 | 10 | 8 | 0 | 2 | 0 | 51.9 |  |
| machine learning researchers | 10 | 10 | 0 | 0 | 10 | 0 | 31.9 |  |
| emails at stripe.com | 4 | 3 | 2 | 2 | 0 | 0 | 4.6 | sources ran out of results |
| real estate agents in Chicago | 10 | 5 | 9 | 1 | 0 | 0 | 46.4 |  |
| plumbers in Denver | 10 | 3 | 7 | 0 | 3 | 0 | 44.1 |  |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
