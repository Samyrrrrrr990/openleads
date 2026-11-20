# OpenLeads live benchmark — v5.6.1 · 2026-11-20

13 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 13/13
- **Fill rate:** 87% of requested leads returned
- **Evidence-backed emails:** 52% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 1% of people failed the person-name check
- **Median time per query:** 21.6s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds | Notes |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| dentists in Austin | 7 | 0 | 7 | 0 | 0 | 0 | 30.4 | local: degraded — overpass-api.de: HTTP 502 |
| marketing agencies in Miami | 9 | 7 | 3 | 0 | 6 | 0 | 34.9 | local: degraded — overpass-api.de: HTTP 502 |
| law firms in London | 9 | 7 | 2 | 0 | 7 | 0 | 13.9 | edgar: failed — www.sec.gov: HTTP 403 (rate-limited or forbidden) |
| accountants in Toronto | 5 | 3 | 2 | 0 | 3 | 0 | 21.6 | local: degraded — overpass→nominatim (all mirrors paused after recent failures) |
| software companies in Berlin | 10 | 2 | 8 | 0 | 2 | 0 | 27.4 |  |
| gyms in Sydney | 10 | 1 | 9 | 0 | 1 | 0 | 46.3 |  |
| fintech founders | 10 | 10 | 0 | 0 | 10 | 1 | 9.1 |  |
| AI startup founders | 10 | 7 | 4 | 0 | 6 | 0 | 13.7 |  |
| rust developers in Berlin | 10 | 10 | 7 | 0 | 3 | 0 | 3.2 |  |
| machine learning researchers | 10 | 10 | 0 | 0 | 10 | 0 | 7.4 |  |
| emails at stripe.com | 4 | 3 | 2 | 2 | 0 | 0 | 1.6 | sources ran out of results |
| real estate agents in Chicago | 9 | 6 | 5 | 1 | 3 | 0 | 31.2 | local: degraded — overpass-api.de: HTTP 502 |
| plumbers in Denver | 10 | 3 | 7 | 0 | 3 | 0 | 48.6 |  |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
