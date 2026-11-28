# OpenLeads live benchmark — v5.6.1 · 2026-11-28

13 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 13/13
- **Fill rate:** 92% of requested leads returned
- **Evidence-backed emails:** 56% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 3% of people failed the person-name check
- **Median time per query:** 43.2s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds | Notes |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| dentists in Austin | 10 | 6 | 5 | 0 | 5 | 0 | 48.6 |  |
| marketing agencies in Miami | 10 | 7 | 6 | 0 | 4 | 0 | 26.2 |  |
| law firms in London | 7 | 1 | 6 | 0 | 1 | 0 | 60.0 | edgar: failed — www.sec.gov: HTTP 403 (rate-limited or forbidden) |
| accountants in Toronto | 10 | 8 | 2 | 0 | 8 | 0 | 43.2 |  |
| software companies in Berlin | 10 | 1 | 9 | 0 | 1 | 0 | 27.1 |  |
| gyms in Sydney | 9 | 3 | 6 | 0 | 3 | 0 | 45.1 | local: degraded — overpass-api.de: timed out |
| fintech founders | 10 | 10 | 1 | 0 | 9 | 1 | 14.9 |  |
| AI startup founders | 10 | 7 | 5 | 0 | 5 | 1 | 9.7 |  |
| rust developers in Berlin | 10 | 10 | 8 | 0 | 2 | 0 | 50.3 |  |
| machine learning researchers | 10 | 10 | 0 | 0 | 10 | 0 | 39.4 |  |
| emails at stripe.com | 4 | 3 | 2 | 2 | 0 | 0 | 4.0 | sources ran out of results |
| real estate agents in Chicago | 9 | 5 | 6 | 1 | 2 | 0 | 43.7 | local: degraded — overpass-api.de: timed out |
| plumbers in Denver | 10 | 3 | 7 | 0 | 3 | 0 | 53.9 |  |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
