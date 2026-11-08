# OpenLeads live benchmark — v5.2.0 · 2026-11-08

13 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 13/13
- **Fill rate:** 83% of requested leads returned
- **Evidence-backed emails:** 73% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 0% of people failed the person-name check
- **Median time per query:** 39.5s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds | Notes |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| dentists in Austin | 10 | 6 | 5 | 0 | 5 | 0 | 46.5 |  |
| marketing agencies in Miami | 10 | 8 | 4 | 0 | 6 | 0 | 46.4 |  |
| law firms in London | 10 | 3 | 10 | 0 | 0 | 0 | 22.1 |  |
| accountants in Toronto | 4 | 0 | 4 | 0 | 0 | 0 | 52.1 | local: degraded — overpass→nominatim (all mirrors paused after recent failures) |
| software companies in Berlin | 10 | 0 | 10 | 0 | 0 | 0 | 19.3 |  |
| gyms in Sydney | 10 | 0 | 10 | 0 | 0 | 0 | 61.0 |  |
| fintech founders | 5 | 3 | 2 | 0 | 3 | 0 | 21.8 | yc: empty |
| AI startup founders | 10 | 6 | 7 | 0 | 3 | 0 | 39.7 |  |
| rust developers in Berlin | 10 | 10 | 8 | 0 | 2 | 0 | 51.2 |  |
| machine learning researchers | 10 | 10 | 0 | 0 | 10 | 0 | 25.9 |  |
| emails at stripe.com | 4 | 3 | 2 | 2 | 0 | 0 | 4.7 | sources ran out of results |
| real estate agents in Chicago | 5 | 0 | 5 | 0 | 0 | 0 | 37.7 | local: degraded — overpass-api.de: timed out |
| plumbers in Denver | 10 | 0 | 10 | 0 | 0 | 0 | 39.5 |  |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
