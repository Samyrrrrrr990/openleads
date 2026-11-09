# OpenLeads live benchmark — v5.2.0 · 2026-11-09

13 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 13/13
- **Fill rate:** 90% of requested leads returned
- **Evidence-backed emails:** 69% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 0% of people failed the person-name check
- **Median time per query:** 34.1s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds | Notes |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| dentists in Austin | 10 | 5 | 7 | 0 | 3 | 0 | 54.2 |  |
| marketing agencies in Miami | 10 | 8 | 4 | 0 | 6 | 0 | 34.9 |  |
| law firms in London | 10 | 7 | 7 | 0 | 3 | 0 | 20.9 |  |
| accountants in Toronto | 8 | 3 | 8 | 0 | 0 | 0 | 30.9 | local: degraded — overpass→nominatim (all mirrors paused after recent failures) |
| software companies in Berlin | 10 | 1 | 9 | 0 | 1 | 0 | 60.0 |  |
| gyms in Sydney | 10 | 5 | 5 | 0 | 5 | 0 | 57.6 |  |
| fintech founders | 5 | 3 | 2 | 0 | 3 | 0 | 21.3 | yc: empty |
| AI startup founders | 10 | 3 | 7 | 0 | 3 | 0 | 39.7 |  |
| rust developers in Berlin | 10 | 10 | 8 | 0 | 2 | 0 | 52.9 |  |
| machine learning researchers | 10 | 10 | 0 | 0 | 10 | 0 | 34.1 |  |
| emails at stripe.com | 4 | 3 | 2 | 2 | 0 | 0 | 4.0 | sources ran out of results |
| real estate agents in Chicago | 10 | 4 | 10 | 0 | 0 | 0 | 28.7 |  |
| plumbers in Denver | 10 | 0 | 10 | 0 | 0 | 0 | 25.3 |  |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
