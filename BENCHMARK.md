# OpenLeads live benchmark — v5.6.1 · 2026-11-25

13 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 13/13
- **Fill rate:** 89% of requested leads returned
- **Evidence-backed emails:** 72% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 4% of people failed the person-name check
- **Median time per query:** 48.5s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds | Notes |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| dentists in Austin | 10 | 4 | 8 | 0 | 2 | 0 | 60.0 |  |
| marketing agencies in Miami | 10 | 8 | 4 | 0 | 6 | 0 | 48.5 |  |
| law firms in London | 10 | 8 | 10 | 0 | 0 | 0 | 31.3 |  |
| accountants in Toronto | 5 | 3 | 5 | 0 | 0 | 0 | 55.2 | local: degraded — overpass→nominatim (all mirrors paused after recent failures) |
| software companies in Berlin | 10 | 4 | 7 | 0 | 3 | 0 | 49.1 |  |
| gyms in Sydney | 8 | 0 | 8 | 0 | 0 | 0 | 60.0 | local: degraded — overpass-api.de: timed out |
| fintech founders | 10 | 10 | 2 | 0 | 8 | 2 | 16.8 |  |
| AI startup founders | 10 | 7 | 3 | 0 | 7 | 1 | 21.6 |  |
| rust developers in Berlin | 10 | 10 | 8 | 0 | 2 | 0 | 50.8 |  |
| machine learning researchers | 10 | 10 | 3 | 3 | 4 | 0 | 35.9 |  |
| emails at stripe.com | 4 | 3 | 2 | 2 | 0 | 0 | 5.0 | sources ran out of results |
| real estate agents in Chicago | 9 | 5 | 7 | 1 | 1 | 0 | 28.9 | local: degraded — overpass-api.de: HTTP 502 |
| plumbers in Denver | 10 | 0 | 10 | 0 | 0 | 0 | 50.3 |  |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
