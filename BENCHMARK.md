# OpenLeads live benchmark — v4.5.0 · 2026-10-12

12 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 12/12
- **Fill rate:** 81% of requested leads returned
- **Evidence-backed emails:** 55% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 3% of people failed the person-name check
- **Median time per query:** 58.1s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds |
|---|---:|---:|---:|---:|---:|---:|---:|
| dentists in Austin | 10 | 5 | 6 | 0 | 4 | 0 | 41.9 |
| marketing agencies in Miami | 4 | 3 | 2 | 1 | 1 | 0 | 47.0 |
| law firms in London | 5 | 5 | 0 | 0 | 5 | 0 | 63.7 |
| accountants in Toronto | 10 | 4 | 6 | 0 | 4 | 0 | 49.8 |
| software companies in Berlin | 10 | 4 | 6 | 0 | 4 | 0 | 105.0 |
| gyms in Sydney | 4 | 1 | 4 | 0 | 0 | 0 | 74.9 |
| fintech founders | 10 | 9 | 4 | 0 | 6 | 1 | 41.9 |
| AI startup founders | 10 | 8 | 3 | 0 | 7 | 1 | 15.8 |
| rust developers in Berlin | 10 | 10 | 7 | 0 | 3 | 0 | 103.5 |
| machine learning researchers | 10 | 10 | 1 | 0 | 9 | 0 | 58.1 |
| emails at stripe.com | 4 | 3 | 2 | 2 | 0 | 0 | 2.9 |
| real estate agents in Chicago | 10 | 3 | 9 | 0 | 1 | 0 | 64.5 |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
