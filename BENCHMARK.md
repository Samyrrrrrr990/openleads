# OpenLeads live benchmark — v5.6.0 · 2026-11-18

13 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 12/13
- **Fill rate:** 79% of requested leads returned
- **Evidence-backed emails:** 76% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 2% of people failed the person-name check
- **Median time per query:** 47.1s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds | Notes |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| dentists in Austin | 10 | 3 | 8 | 0 | 2 | 0 | 52.2 |  |
| marketing agencies in Miami | 5 | 0 | 5 | 0 | 0 | 0 | 49.2 | local: degraded — overpass-api.de: timed out |
| law firms in London | 10 | 5 | 5 | 0 | 5 | 0 | 60.0 |  |
| accountants in Toronto | 5 | 1 | 4 | 0 | 1 | 0 | 60.0 | local: degraded — overpass→nominatim (all mirrors paused after recent failures) |
| software companies in Berlin | 10 | 0 | 10 | 0 | 0 | 0 | 47.1 |  |
| gyms in Sydney | 10 | 4 | 9 | 0 | 1 | 0 | 58.8 |  |
| fintech founders | 10 | 10 | 2 | 0 | 8 | 1 | 21.3 |  |
| AI startup founders | 10 | 7 | 7 | 0 | 3 | 0 | 11.5 |  |
| rust developers in Berlin | 10 | 10 | 8 | 0 | 2 | 0 | 50.3 |  |
| machine learning researchers | 0 | 0 | 0 | 0 | 0 | 0 | 16.4 | openalex: failed — api.openalex.org: HTTP 429 (rate-limited) |
| emails at stripe.com | 4 | 3 | 2 | 2 | 0 | 0 | 4.4 | sources ran out of results |
| real estate agents in Chicago | 9 | 3 | 8 | 1 | 0 | 0 | 43.3 | local: degraded — overpass-api.de: timed out |
| plumbers in Denver | 10 | 3 | 7 | 0 | 3 | 0 | 46.4 |  |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
