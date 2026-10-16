# OpenLeads live benchmark — v5.0.0 · 2026-10-16

12 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 12/12
- **Fill rate:** 84% of requested leads returned
- **Evidence-backed emails:** 58% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 0% of people failed the person-name check
- **Median time per query:** 54.5s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds |
|---|---:|---:|---:|---:|---:|---:|---:|
| dentists in Austin | 10 | 7 | 4 | 0 | 6 | 0 | 41.8 |
| marketing agencies in Miami | 4 | 3 | 2 | 1 | 1 | 0 | 38.3 |
| law firms in London | 4 | 3 | 1 | 0 | 3 | 0 | 108.9 |
| accountants in Toronto | 10 | 7 | 6 | 0 | 4 | 0 | 54.5 |
| software companies in Berlin | 10 | 3 | 7 | 0 | 3 | 0 | 41.8 |
| gyms in Sydney | 10 | 4 | 7 | 0 | 3 | 0 | 98.4 |
| fintech founders | 10 | 9 | 4 | 0 | 6 | 0 | 33.9 |
| AI startup founders | 10 | 7 | 5 | 0 | 5 | 0 | 17.4 |
| rust developers in Berlin | 10 | 10 | 8 | 0 | 2 | 0 | 103.2 |
| machine learning researchers | 10 | 10 | 2 | 0 | 8 | 0 | 56.1 |
| emails at stripe.com | 3 | 3 | 1 | 2 | 0 | 0 | 4.1 |
| real estate agents in Chicago | 10 | 3 | 9 | 0 | 1 | 0 | 59.1 |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
