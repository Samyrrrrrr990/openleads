# OpenLeads live benchmark — v4.6.1 · 2026-10-15

12 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 12/12
- **Fill rate:** 90% of requested leads returned
- **Evidence-backed emails:** 47% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 0% of people failed the person-name check
- **Median time per query:** 50.6s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds |
|---|---:|---:|---:|---:|---:|---:|---:|
| dentists in Austin | 10 | 7 | 4 | 0 | 6 | 0 | 60.7 |
| marketing agencies in Miami | 10 | 8 | 5 | 0 | 5 | 0 | 12.9 |
| law firms in London | 10 | 9 | 1 | 0 | 9 | 0 | 50.6 |
| accountants in Toronto | 5 | 3 | 2 | 0 | 3 | 0 | 84.9 |
| software companies in Berlin | 10 | 4 | 6 | 0 | 4 | 0 | 107.9 |
| gyms in Sydney | 10 | 4 | 6 | 0 | 4 | 0 | 75.8 |
| fintech founders | 10 | 9 | 4 | 0 | 6 | 0 | 17.6 |
| AI startup founders | 10 | 7 | 3 | 0 | 7 | 0 | 16.5 |
| rust developers in Berlin | 10 | 10 | 7 | 0 | 3 | 0 | 100.5 |
| machine learning researchers | 10 | 10 | 0 | 0 | 10 | 0 | 22.1 |
| emails at stripe.com | 3 | 3 | 1 | 2 | 0 | 0 | 2.5 |
| real estate agents in Chicago | 10 | 3 | 9 | 1 | 0 | 0 | 30.7 |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
