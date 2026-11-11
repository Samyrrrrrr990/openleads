# OpenLeads live benchmark — v5.2.0 · 2026-11-11

13 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 13/13
- **Fill rate:** 91% of requested leads returned
- **Evidence-backed emails:** 65% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 1% of people failed the person-name check
- **Median time per query:** 41.5s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds | Notes |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| dentists in Austin | 7 | 0 | 7 | 0 | 0 | 0 | 48.5 | local: degraded — overpass-api.de: timed out |
| marketing agencies in Miami | 10 | 8 | 4 | 0 | 6 | 0 | 39.9 |  |
| law firms in London | 10 | 6 | 4 | 0 | 6 | 0 | 60.0 |  |
| accountants in Toronto | 10 | 5 | 8 | 0 | 2 | 0 | 60.0 |  |
| software companies in Berlin | 10 | 0 | 10 | 0 | 0 | 0 | 41.4 |  |
| gyms in Sydney | 10 | 5 | 8 | 0 | 2 | 0 | 60.0 |  |
| fintech founders | 10 | 8 | 3 | 0 | 7 | 1 | 16.1 |  |
| AI startup founders | 10 | 7 | 7 | 0 | 3 | 0 | 22.5 |  |
| rust developers in Berlin | 10 | 10 | 8 | 0 | 2 | 0 | 51.5 |  |
| machine learning researchers | 10 | 10 | 0 | 0 | 10 | 0 | 25.2 |  |
| emails at stripe.com | 4 | 3 | 2 | 2 | 0 | 0 | 4.0 | sources ran out of results |
| real estate agents in Chicago | 7 | 4 | 6 | 1 | 0 | 0 | 42.8 | local: degraded — overpass-api.de: timed out |
| plumbers in Denver | 10 | 3 | 7 | 0 | 3 | 0 | 41.5 |  |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
