# OpenLeads live benchmark — v5.0.0 · 2026-10-17

12 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 12/12
- **Fill rate:** 68% of requested leads returned
- **Evidence-backed emails:** 51% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 0% of people failed the person-name check
- **Median time per query:** 62.2s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds |
|---|---:|---:|---:|---:|---:|---:|---:|
| dentists in Austin | 10 | 7 | 4 | 0 | 6 | 0 | 50.9 |
| marketing agencies in Miami | 4 | 3 | 2 | 2 | 0 | 0 | 18.2 |
| law firms in London | 4 | 3 | 1 | 0 | 3 | 0 | 139.9 |
| accountants in Toronto | 6 | 4 | 2 | 0 | 4 | 0 | 62.2 |
| software companies in Berlin | 5 | 3 | 2 | 0 | 3 | 0 | 71.2 |
| gyms in Sydney | 4 | 1 | 4 | 0 | 0 | 0 | 67.6 |
| fintech founders | 10 | 9 | 3 | 0 | 7 | 0 | 55.6 |
| AI startup founders | 10 | 7 | 3 | 0 | 7 | 0 | 49.9 |
| rust developers in Berlin | 10 | 10 | 8 | 0 | 2 | 0 | 109.8 |
| machine learning researchers | 10 | 10 | 2 | 0 | 8 | 0 | 61.0 |
| emails at stripe.com | 3 | 3 | 1 | 2 | 0 | 0 | 4.6 |
| real estate agents in Chicago | 5 | 3 | 4 | 1 | 0 | 0 | 66.4 |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
