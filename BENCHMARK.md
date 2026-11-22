# OpenLeads live benchmark — v5.6.1 · 2026-11-22

13 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 12/13
- **Fill rate:** 88% of requested leads returned
- **Evidence-backed emails:** 64% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 1% of people failed the person-name check
- **Median time per query:** 35.2s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds | Notes |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| dentists in Austin | 10 | 4 | 7 | 0 | 3 | 0 | 35.2 |  |
| marketing agencies in Miami | 10 | 8 | 4 | 0 | 6 | 0 | 36.0 |  |
| law firms in London | 10 | 9 | 7 | 0 | 3 | 0 | 37.5 |  |
| accountants in Toronto | 10 | 7 | 4 | 0 | 6 | 0 | 29.4 |  |
| software companies in Berlin | 10 | 0 | 10 | 0 | 0 | 0 | 60.0 |  |
| gyms in Sydney | 10 | 3 | 7 | 0 | 3 | 0 | 38.6 |  |
| fintech founders | 10 | 10 | 1 | 0 | 9 | 1 | 17.5 |  |
| AI startup founders | 10 | 7 | 5 | 0 | 5 | 0 | 12.0 |  |
| rust developers in Berlin | 10 | 10 | 8 | 0 | 2 | 0 | 51.7 |  |
| machine learning researchers | 0 | 0 | 0 | 0 | 0 | 0 | 16.2 | openalex: failed — api.openalex.org: HTTP 429 (rate-limited) |
| emails at stripe.com | 4 | 3 | 2 | 2 | 0 | 0 | 4.7 | sources ran out of results |
| real estate agents in Chicago | 10 | 7 | 8 | 1 | 1 | 0 | 32.6 |  |
| plumbers in Denver | 10 | 3 | 7 | 0 | 3 | 0 | 52.2 |  |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
