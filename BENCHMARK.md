# OpenLeads live benchmark — v5.6.1 · 2026-11-19

13 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 13/13
- **Fill rate:** 91% of requested leads returned
- **Evidence-backed emails:** 64% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 1% of people failed the person-name check
- **Median time per query:** 51.5s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds | Notes |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| dentists in Austin | 9 | 6 | 6 | 0 | 3 | 0 | 38.1 | local: degraded — overpass-api.de: HTTP 502 |
| marketing agencies in Miami | 9 | 7 | 3 | 0 | 6 | 0 | 51.5 | local: degraded — overpass-api.de: timed out |
| law firms in London | 9 | 6 | 3 | 0 | 6 | 0 | 60.0 | edgar: failed — www.sec.gov: HTTP 403 (rate-limited or forbidden) |
| accountants in Toronto | 10 | 7 | 7 | 0 | 3 | 0 | 29.6 |  |
| software companies in Berlin | 10 | 0 | 10 | 0 | 0 | 0 | 55.4 |  |
| gyms in Sydney | 9 | 0 | 9 | 0 | 0 | 0 | 61.0 | local: degraded — overpass-api.de: timed out |
| fintech founders | 10 | 10 | 1 | 0 | 9 | 1 | 16.8 |  |
| AI startup founders | 10 | 7 | 6 | 0 | 4 | 0 | 13.4 |  |
| rust developers in Berlin | 10 | 10 | 8 | 0 | 2 | 0 | 51.5 |  |
| machine learning researchers | 10 | 10 | 0 | 0 | 10 | 0 | 25.6 |  |
| emails at stripe.com | 4 | 3 | 2 | 2 | 0 | 0 | 4.6 | sources ran out of results |
| real estate agents in Chicago | 8 | 3 | 7 | 1 | 0 | 0 | 53.0 | local: degraded — overpass-api.de: timed out |
| plumbers in Denver | 10 | 0 | 10 | 0 | 0 | 0 | 54.3 |  |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
