# OpenLeads live benchmark — v5.2.0 · 2026-11-10

13 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 13/13
- **Fill rate:** 86% of requested leads returned
- **Evidence-backed emails:** 55% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 2% of people failed the person-name check
- **Median time per query:** 51.2s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds | Notes |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| dentists in Austin | 9 | 4 | 6 | 0 | 3 | 0 | 58.2 | local: degraded — overpass-api.de: HTTP 502 |
| marketing agencies in Miami | 4 | 0 | 4 | 0 | 0 | 0 | 51.2 | local: degraded — overpass-api.de: HTTP 502 |
| law firms in London | 10 | 7 | 3 | 0 | 7 | 0 | 59.1 |  |
| accountants in Toronto | 10 | 5 | 5 | 0 | 5 | 0 | 25.7 |  |
| software companies in Berlin | 10 | 5 | 5 | 1 | 4 | 0 | 42.4 |  |
| gyms in Sydney | 7 | 2 | 5 | 0 | 2 | 0 | 59.3 | local: degraded — overpass-api.de: timed out |
| fintech founders | 10 | 8 | 2 | 0 | 8 | 1 | 15.1 |  |
| AI startup founders | 10 | 8 | 3 | 0 | 7 | 0 | 22.7 |  |
| rust developers in Berlin | 10 | 10 | 8 | 0 | 2 | 0 | 50.2 |  |
| machine learning researchers | 9 | 9 | 0 | 0 | 9 | 0 | 60.0 | openalex: timeout — people discovery skipped (budget) |
| emails at stripe.com | 4 | 3 | 2 | 2 | 0 | 0 | 4.2 | sources ran out of results |
| real estate agents in Chicago | 9 | 7 | 4 | 1 | 4 | 0 | 57.9 | local: degraded — overpass-api.de: timed out |
| plumbers in Denver | 10 | 0 | 10 | 0 | 0 | 0 | 54.0 |  |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
