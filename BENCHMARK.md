# OpenLeads live benchmark — v5.1.1 · 2026-10-31

13 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 13/13
- **Fill rate:** 82% of requested leads returned
- **Evidence-backed emails:** 62% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 0% of people failed the person-name check
- **Median time per query:** 48.3s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds | Notes |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| dentists in Austin | 10 | 4 | 8 | 0 | 2 | 0 | 48.0 |  |
| marketing agencies in Miami | 10 | 8 | 4 | 0 | 6 | 0 | 48.3 |  |
| law firms in London | 10 | 6 | 4 | 0 | 6 | 0 | 60.0 |  |
| accountants in Toronto | 10 | 7 | 6 | 0 | 4 | 0 | 26.8 |  |
| software companies in Berlin | 10 | 0 | 10 | 0 | 0 | 0 | 60.0 |  |
| gyms in Sydney | 1 | 0 | 1 | 0 | 0 | 0 | 60.5 | local: timeout — overpass-api.de: timed out |
| fintech founders | 4 | 3 | 1 | 0 | 3 | 0 | 32.6 | yc: empty |
| AI startup founders | 10 | 4 | 6 | 0 | 4 | 0 | 26.8 |  |
| rust developers in Berlin | 10 | 10 | 8 | 0 | 2 | 0 | 51.5 |  |
| machine learning researchers | 10 | 10 | 0 | 0 | 10 | 0 | 53.6 |  |
| emails at stripe.com | 4 | 3 | 2 | 2 | 0 | 0 | 5.0 | sources ran out of results |
| real estate agents in Chicago | 8 | 4 | 6 | 1 | 1 | 0 | 46.9 | local: degraded — overpass-api.de: timed out |
| plumbers in Denver | 10 | 3 | 7 | 0 | 3 | 0 | 58.3 |  |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
