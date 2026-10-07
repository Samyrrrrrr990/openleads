# OpenLeads live benchmark — v4.5.0 · 2026-10-07

12 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 12/12
- **Fill rate:** 84% of requested leads returned
- **Evidence-backed emails:** 32% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 0% of people failed the person-name check
- **Median time per query:** 53.6s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds |
|---|---:|---:|---:|---:|---:|---:|---:|
| dentists in Austin | 10 | 6 | 4 | 0 | 6 | 0 | 67.7 |
| marketing agencies in Miami | 4 | 3 | 2 | 0 | 2 | 0 | 38.5 |
| law firms in London | 10 | 8 | 2 | 0 | 8 | 0 | 66.0 |
| accountants in Toronto | 10 | 7 | 3 | 0 | 7 | 0 | 63.0 |
| software companies in Berlin | 10 | 3 | 7 | 0 | 3 | 0 | 57.0 |
| gyms in Sydney | 4 | 1 | 3 | 0 | 1 | 0 | 67.3 |
| fintech founders | 10 | 9 | 1 | 0 | 9 | 0 | 8.7 |
| AI startup founders | 10 | 10 | 0 | 0 | 10 | 0 | 10.4 |
| rust developers in Berlin | 10 | 10 | 0 | 0 | 10 | 0 | 5.4 |
| machine learning researchers | 10 | 10 | 0 | 0 | 10 | 0 | 5.4 |
| emails at stripe.com | 3 | 3 | 1 | 0 | 2 | 0 | 2.9 |
| real estate agents in Chicago | 10 | 3 | 9 | 0 | 1 | 0 | 53.6 |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
