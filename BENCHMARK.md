# OpenLeads live benchmark — v5.5.0 · 2026-11-17

13 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 13/13
- **Fill rate:** 94% of requested leads returned
- **Evidence-backed emails:** 64% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 1% of people failed the person-name check
- **Median time per query:** 40.2s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds | Notes |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| dentists in Austin | 10 | 5 | 7 | 0 | 3 | 0 | 47.9 |  |
| marketing agencies in Miami | 10 | 8 | 4 | 0 | 6 | 0 | 51.6 |  |
| law firms in London | 10 | 7 | 8 | 0 | 2 | 0 | 18.5 |  |
| accountants in Toronto | 10 | 7 | 6 | 0 | 4 | 0 | 59.8 |  |
| software companies in Berlin | 10 | 3 | 8 | 1 | 1 | 0 | 34.8 |  |
| gyms in Sydney | 10 | 2 | 9 | 0 | 1 | 0 | 47.1 |  |
| fintech founders | 10 | 10 | 2 | 0 | 8 | 1 | 16.3 |  |
| AI startup founders | 10 | 7 | 7 | 0 | 3 | 0 | 15.3 |  |
| rust developers in Berlin | 10 | 10 | 8 | 0 | 2 | 0 | 51.9 |  |
| machine learning researchers | 10 | 10 | 0 | 0 | 10 | 0 | 25.4 |  |
| emails at stripe.com | 4 | 3 | 2 | 2 | 0 | 0 | 4.7 | sources ran out of results |
| real estate agents in Chicago | 8 | 4 | 7 | 0 | 1 | 0 | 40.2 | local: degraded — overpass-api.de: timed out |
| plumbers in Denver | 10 | 3 | 7 | 0 | 3 | 0 | 48.9 |  |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
