# OpenLeads live benchmark — v5.6.1 · 2026-11-24

13 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 13/13
- **Fill rate:** 94% of requested leads returned
- **Evidence-backed emails:** 66% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 1% of people failed the person-name check
- **Median time per query:** 52.8s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds | Notes |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| dentists in Austin | 10 | 3 | 10 | 0 | 0 | 0 | 61.0 |  |
| marketing agencies in Miami | 10 | 8 | 4 | 0 | 6 | 0 | 54.4 |  |
| law firms in London | 10 | 7 | 7 | 1 | 2 | 0 | 60.0 |  |
| accountants in Toronto | 8 | 6 | 5 | 0 | 3 | 0 | 28.3 | local: degraded — overpass→nominatim (all mirrors paused after recent failures) |
| software companies in Berlin | 10 | 3 | 8 | 0 | 2 | 0 | 60.0 |  |
| gyms in Sydney | 10 | 0 | 10 | 0 | 0 | 0 | 56.7 |  |
| fintech founders | 10 | 10 | 1 | 0 | 9 | 1 | 31.0 |  |
| AI startup founders | 10 | 7 | 5 | 0 | 5 | 0 | 43.4 |  |
| rust developers in Berlin | 10 | 10 | 8 | 0 | 2 | 0 | 52.8 |  |
| machine learning researchers | 10 | 10 | 0 | 0 | 10 | 0 | 30.8 |  |
| emails at stripe.com | 4 | 3 | 2 | 2 | 0 | 0 | 5.0 | sources ran out of results |
| real estate agents in Chicago | 10 | 5 | 9 | 1 | 0 | 0 | 30.4 |  |
| plumbers in Denver | 10 | 3 | 7 | 0 | 3 | 0 | 53.5 |  |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
