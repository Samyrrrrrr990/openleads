# OpenLeads live benchmark — v5.6.1 · 2026-11-21

13 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 13/13
- **Fill rate:** 94% of requested leads returned
- **Evidence-backed emails:** 61% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 1% of people failed the person-name check
- **Median time per query:** 37.1s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds | Notes |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| dentists in Austin | 10 | 6 | 7 | 0 | 3 | 0 | 37.1 |  |
| marketing agencies in Miami | 10 | 8 | 4 | 0 | 6 | 0 | 35.7 |  |
| law firms in London | 10 | 8 | 7 | 1 | 2 | 0 | 39.2 |  |
| accountants in Toronto | 10 | 6 | 6 | 0 | 4 | 0 | 58.8 |  |
| software companies in Berlin | 10 | 3 | 7 | 0 | 3 | 0 | 58.7 |  |
| gyms in Sydney | 8 | 0 | 8 | 0 | 0 | 0 | 40.6 | local: degraded — overpass.private.coffee: timed out |
| fintech founders | 10 | 10 | 1 | 0 | 9 | 1 | 16.1 |  |
| AI startup founders | 10 | 7 | 5 | 0 | 5 | 0 | 12.6 |  |
| rust developers in Berlin | 10 | 10 | 8 | 0 | 2 | 0 | 51.4 |  |
| machine learning researchers | 10 | 10 | 0 | 0 | 10 | 0 | 29.7 |  |
| emails at stripe.com | 4 | 3 | 2 | 2 | 0 | 0 | 5.1 | sources ran out of results |
| real estate agents in Chicago | 10 | 7 | 9 | 0 | 1 | 0 | 31.8 |  |
| plumbers in Denver | 10 | 3 | 7 | 0 | 3 | 0 | 50.9 |  |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
