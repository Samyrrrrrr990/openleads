# OpenLeads live benchmark — v5.5.0 · 2026-11-13

13 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 13/13
- **Fill rate:** 93% of requested leads returned
- **Evidence-backed emails:** 61% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 1% of people failed the person-name check
- **Median time per query:** 32.4s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds | Notes |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| dentists in Austin | 10 | 5 | 6 | 0 | 4 | 0 | 51.6 |  |
| marketing agencies in Miami | 10 | 8 | 4 | 0 | 6 | 0 | 56.5 |  |
| law firms in London | 10 | 6 | 10 | 0 | 0 | 0 | 13.9 |  |
| accountants in Toronto | 9 | 7 | 5 | 0 | 4 | 0 | 56.9 | local: degraded — overpass→nominatim (all mirrors paused after recent failures) |
| software companies in Berlin | 10 | 0 | 10 | 0 | 0 | 0 | 24.1 |  |
| gyms in Sydney | 10 | 3 | 7 | 0 | 3 | 0 | 37.3 |  |
| fintech founders | 10 | 10 | 1 | 0 | 9 | 1 | 15.9 |  |
| AI startup founders | 10 | 7 | 4 | 0 | 6 | 0 | 13.1 |  |
| rust developers in Berlin | 10 | 10 | 8 | 0 | 2 | 0 | 50.6 |  |
| machine learning researchers | 10 | 10 | 0 | 0 | 10 | 0 | 24.3 |  |
| emails at stripe.com | 4 | 3 | 2 | 2 | 0 | 0 | 4.3 | sources ran out of results |
| real estate agents in Chicago | 8 | 3 | 8 | 0 | 0 | 0 | 32.4 | local: degraded — overpass-api.de: HTTP 502 |
| plumbers in Denver | 10 | 3 | 7 | 0 | 3 | 0 | 39.3 |  |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
