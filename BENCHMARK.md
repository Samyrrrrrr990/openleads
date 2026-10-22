# OpenLeads live benchmark — v5.0.0 · 2026-10-22

12 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 12/12
- **Fill rate:** 78% of requested leads returned
- **Evidence-backed emails:** 51% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 0% of people failed the person-name check
- **Median time per query:** 62.5s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds |
|---|---:|---:|---:|---:|---:|---:|---:|
| dentists in Austin | 10 | 7 | 4 | 0 | 6 | 0 | 69.2 |
| marketing agencies in Miami | 9 | 7 | 3 | 2 | 4 | 0 | 44.0 |
| law firms in London | 4 | 2 | 2 | 0 | 2 | 0 | 89.4 |
| accountants in Toronto | 4 | 3 | 1 | 0 | 3 | 0 | 62.5 |
| software companies in Berlin | 5 | 3 | 2 | 0 | 3 | 0 | 70.7 |
| gyms in Sydney | 9 | 4 | 5 | 0 | 4 | 0 | 86.2 |
| fintech founders | 10 | 9 | 4 | 0 | 6 | 0 | 18.2 |
| AI startup founders | 10 | 7 | 5 | 0 | 5 | 0 | 17.4 |
| rust developers in Berlin | 10 | 10 | 8 | 0 | 2 | 0 | 100.6 |
| machine learning researchers | 10 | 10 | 0 | 0 | 10 | 0 | 34.8 |
| emails at stripe.com | 3 | 3 | 1 | 2 | 0 | 0 | 3.7 |
| real estate agents in Chicago | 10 | 4 | 8 | 1 | 1 | 0 | 53.0 |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
