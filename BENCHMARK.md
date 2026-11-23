# OpenLeads live benchmark — v5.6.1 · 2026-11-23

13 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 13/13
- **Fill rate:** 94% of requested leads returned
- **Evidence-backed emails:** 59% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 1% of people failed the person-name check
- **Median time per query:** 45.0s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds | Notes |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| dentists in Austin | 10 | 5 | 6 | 0 | 4 | 0 | 50.2 |  |
| marketing agencies in Miami | 10 | 8 | 4 | 0 | 6 | 0 | 43.8 |  |
| law firms in London | 10 | 8 | 5 | 1 | 4 | 0 | 60.0 |  |
| accountants in Toronto | 10 | 7 | 4 | 2 | 4 | 0 | 60.0 |  |
| software companies in Berlin | 10 | 3 | 7 | 0 | 3 | 0 | 39.3 |  |
| gyms in Sydney | 10 | 0 | 10 | 0 | 0 | 0 | 54.9 |  |
| fintech founders | 10 | 10 | 1 | 0 | 9 | 1 | 16.8 |  |
| AI startup founders | 10 | 7 | 5 | 0 | 5 | 0 | 14.6 |  |
| rust developers in Berlin | 10 | 10 | 8 | 0 | 2 | 0 | 51.1 |  |
| machine learning researchers | 10 | 10 | 0 | 0 | 10 | 0 | 28.5 |  |
| emails at stripe.com | 4 | 3 | 2 | 2 | 0 | 0 | 4.3 | sources ran out of results |
| real estate agents in Chicago | 8 | 3 | 7 | 1 | 0 | 0 | 45.0 | local: degraded — overpass-api.de: timed out |
| plumbers in Denver | 10 | 3 | 7 | 0 | 3 | 0 | 45.8 |  |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
