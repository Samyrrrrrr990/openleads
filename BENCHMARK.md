# OpenLeads live benchmark — v5.2.0 · 2026-11-05

13 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 13/13
- **Fill rate:** 91% of requested leads returned
- **Evidence-backed emails:** 55% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 0% of people failed the person-name check
- **Median time per query:** 37.2s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds | Notes |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| dentists in Austin | 9 | 4 | 5 | 0 | 4 | 0 | 42.9 | local: degraded — overpass-api.de: HTTP 502 |
| marketing agencies in Miami | 10 | 8 | 4 | 0 | 6 | 0 | 48.9 |  |
| law firms in London | 10 | 3 | 7 | 0 | 3 | 0 | 21.8 |  |
| accountants in Toronto | 10 | 7 | 3 | 0 | 7 | 0 | 31.6 |  |
| software companies in Berlin | 10 | 3 | 7 | 1 | 2 | 0 | 39.1 |  |
| gyms in Sydney | 10 | 3 | 7 | 0 | 3 | 0 | 34.2 |  |
| fintech founders | 6 | 3 | 3 | 0 | 3 | 0 | 36.3 | yc: empty |
| AI startup founders | 10 | 6 | 4 | 0 | 6 | 0 | 36.8 |  |
| rust developers in Berlin | 10 | 10 | 8 | 0 | 2 | 0 | 52.0 |  |
| machine learning researchers | 10 | 10 | 0 | 0 | 10 | 0 | 37.2 |  |
| emails at stripe.com | 4 | 3 | 2 | 2 | 0 | 0 | 5.0 | sources ran out of results |
| real estate agents in Chicago | 9 | 7 | 4 | 1 | 4 | 0 | 42.4 | local: degraded — overpass-api.de: HTTP 502 |
| plumbers in Denver | 10 | 3 | 7 | 0 | 3 | 0 | 47.6 |  |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
