# OpenLeads live benchmark — v5.6.1 · 2026-11-27

13 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 13/13
- **Fill rate:** 92% of requested leads returned
- **Evidence-backed emails:** 62% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 3% of people failed the person-name check
- **Median time per query:** 40.2s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds | Notes |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| dentists in Austin | 10 | 6 | 6 | 0 | 4 | 0 | 40.2 |  |
| marketing agencies in Miami | 10 | 8 | 3 | 0 | 7 | 0 | 53.8 |  |
| law firms in London | 10 | 8 | 2 | 0 | 8 | 0 | 59.1 |  |
| accountants in Toronto | 6 | 4 | 2 | 0 | 4 | 0 | 60.0 | local: degraded — overpass→nominatim (all mirrors paused after recent failures) |
| software companies in Berlin | 10 | 0 | 10 | 0 | 0 | 0 | 27.5 |  |
| gyms in Sydney | 10 | 0 | 10 | 0 | 0 | 0 | 61.0 |  |
| fintech founders | 10 | 10 | 1 | 0 | 9 | 1 | 30.5 |  |
| AI startup founders | 10 | 7 | 5 | 0 | 5 | 1 | 10.1 |  |
| rust developers in Berlin | 10 | 10 | 8 | 0 | 2 | 0 | 51.4 |  |
| machine learning researchers | 10 | 10 | 3 | 3 | 4 | 0 | 35.7 |  |
| emails at stripe.com | 4 | 3 | 2 | 2 | 0 | 0 | 4.1 | sources ran out of results |
| real estate agents in Chicago | 10 | 4 | 10 | 0 | 0 | 0 | 20.3 |  |
| plumbers in Denver | 10 | 3 | 7 | 0 | 3 | 0 | 51.6 |  |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
