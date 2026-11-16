# OpenLeads live benchmark — v5.5.0 · 2026-11-16

13 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 13/13
- **Fill rate:** 87% of requested leads returned
- **Evidence-backed emails:** 66% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 5% of people failed the person-name check
- **Median time per query:** 50.5s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds | Notes |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| dentists in Austin | 3 | 0 | 3 | 0 | 0 | 0 | 50.5 | local: degraded — overpass-api.de: timed out |
| marketing agencies in Miami | 10 | 8 | 4 | 0 | 6 | 0 | 55.7 |  |
| law firms in London | 10 | 7 | 6 | 0 | 4 | 0 | 59.4 |  |
| accountants in Toronto | 10 | 5 | 9 | 0 | 1 | 0 | 60.0 |  |
| software companies in Berlin | 10 | 0 | 10 | 0 | 0 | 0 | 39.7 |  |
| gyms in Sydney | 10 | 0 | 10 | 0 | 0 | 0 | 32.7 |  |
| fintech founders | 10 | 10 | 2 | 0 | 8 | 3 | 15.4 |  |
| AI startup founders | 10 | 7 | 4 | 0 | 6 | 0 | 12.4 |  |
| rust developers in Berlin | 10 | 10 | 8 | 0 | 2 | 0 | 52.5 |  |
| machine learning researchers | 10 | 10 | 0 | 0 | 10 | 0 | 54.4 |  |
| emails at stripe.com | 4 | 3 | 2 | 2 | 0 | 0 | 4.2 | sources ran out of results |
| real estate agents in Chicago | 6 | 2 | 5 | 0 | 1 | 0 | 25.9 | local: degraded — overpass-api.de: HTTP 502 |
| plumbers in Denver | 10 | 0 | 10 | 0 | 0 | 0 | 56.4 |  |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
