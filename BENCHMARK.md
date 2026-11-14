# OpenLeads live benchmark — v5.5.0 · 2026-11-14

13 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 13/13
- **Fill rate:** 92% of requested leads returned
- **Evidence-backed emails:** 48% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 1% of people failed the person-name check
- **Median time per query:** 17.7s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds | Notes |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| dentists in Austin | 10 | 4 | 6 | 0 | 4 | 0 | 52.3 |  |
| marketing agencies in Miami | 10 | 6 | 4 | 0 | 6 | 0 | 37.4 |  |
| law firms in London | 10 | 7 | 3 | 0 | 7 | 0 | 14.3 |  |
| accountants in Toronto | 10 | 7 | 3 | 0 | 7 | 0 | 22.4 |  |
| software companies in Berlin | 10 | 0 | 10 | 0 | 0 | 0 | 17.7 |  |
| gyms in Sydney | 10 | 5 | 5 | 0 | 5 | 0 | 42.0 |  |
| fintech founders | 10 | 10 | 0 | 0 | 10 | 1 | 10.2 |  |
| AI startup founders | 10 | 7 | 4 | 0 | 6 | 0 | 11.0 |  |
| rust developers in Berlin | 10 | 10 | 7 | 0 | 3 | 0 | 2.7 |  |
| machine learning researchers | 10 | 10 | 0 | 0 | 10 | 0 | 7.5 |  |
| emails at stripe.com | 4 | 3 | 2 | 2 | 0 | 0 | 1.6 | sources ran out of results |
| real estate agents in Chicago | 6 | 1 | 5 | 0 | 1 | 0 | 40.0 | local: degraded — overpass-api.de: timed out |
| plumbers in Denver | 10 | 3 | 7 | 0 | 3 | 0 | 47.4 |  |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
