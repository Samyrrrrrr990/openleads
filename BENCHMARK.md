# OpenLeads live benchmark — v5.6.1 · 2026-11-26

13 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 13/13
- **Fill rate:** 93% of requested leads returned
- **Evidence-backed emails:** 65% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 1% of people failed the person-name check
- **Median time per query:** 46.2s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds | Notes |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| dentists in Austin | 10 | 4 | 7 | 0 | 3 | 0 | 47.5 |  |
| marketing agencies in Miami | 10 | 6 | 4 | 0 | 6 | 0 | 49.1 |  |
| law firms in London | 10 | 7 | 3 | 0 | 7 | 0 | 60.0 |  |
| accountants in Toronto | 7 | 2 | 6 | 0 | 1 | 0 | 60.0 | local: degraded — overpass→nominatim (all mirrors paused after recent failures) |
| software companies in Berlin | 10 | 0 | 10 | 0 | 0 | 0 | 41.3 |  |
| gyms in Sydney | 10 | 5 | 8 | 0 | 2 | 0 | 46.2 |  |
| fintech founders | 10 | 10 | 1 | 0 | 9 | 1 | 31.6 |  |
| AI startup founders | 10 | 7 | 5 | 0 | 5 | 0 | 12.7 |  |
| rust developers in Berlin | 10 | 10 | 8 | 0 | 2 | 0 | 52.8 |  |
| machine learning researchers | 10 | 10 | 3 | 3 | 4 | 0 | 34.0 |  |
| emails at stripe.com | 4 | 3 | 2 | 2 | 0 | 0 | 4.0 | sources ran out of results |
| real estate agents in Chicago | 10 | 7 | 9 | 1 | 0 | 0 | 47.0 |  |
| plumbers in Denver | 10 | 3 | 7 | 0 | 3 | 0 | 42.1 |  |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
