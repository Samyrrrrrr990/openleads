# OpenLeads live benchmark — v5.2.0 · 2026-11-07

13 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 13/13
- **Fill rate:** 85% of requested leads returned
- **Evidence-backed emails:** 70% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 0% of people failed the person-name check
- **Median time per query:** 48.8s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds | Notes |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| dentists in Austin | 9 | 5 | 5 | 0 | 4 | 0 | 48.8 | local: degraded — overpass-api.de: HTTP 502 |
| marketing agencies in Miami | 10 | 8 | 4 | 0 | 6 | 0 | 49.0 |  |
| law firms in London | 8 | 4 | 6 | 0 | 2 | 0 | 60.0 | edgar: failed — www.sec.gov: HTTP 403 (rate-limited or forbidden) |
| accountants in Toronto | 10 | 7 | 7 | 2 | 1 | 0 | 51.2 |  |
| software companies in Berlin | 10 | 3 | 7 | 1 | 2 | 0 | 60.0 |  |
| gyms in Sydney | 9 | 0 | 9 | 0 | 0 | 0 | 54.9 | local: degraded — overpass-api.de: HTTP 502 |
| fintech founders | 6 | 3 | 3 | 0 | 3 | 0 | 23.4 | yc: empty |
| AI startup founders | 10 | 6 | 7 | 0 | 3 | 0 | 38.6 |  |
| rust developers in Berlin | 10 | 10 | 8 | 0 | 2 | 0 | 52.5 |  |
| machine learning researchers | 10 | 10 | 0 | 0 | 10 | 0 | 30.4 |  |
| emails at stripe.com | 4 | 3 | 2 | 2 | 0 | 0 | 4.5 | sources ran out of results |
| real estate agents in Chicago | 5 | 0 | 5 | 0 | 0 | 0 | 25.0 | local: degraded — overpass-api.de: HTTP 502 |
| plumbers in Denver | 10 | 0 | 10 | 0 | 0 | 0 | 48.6 |  |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
