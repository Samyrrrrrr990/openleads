# OpenLeads live benchmark — v5.0.0 · 2026-10-19

12 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 12/12
- **Fill rate:** 86% of requested leads returned
- **Evidence-backed emails:** 47% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 1% of people failed the person-name check
- **Median time per query:** 58.6s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds |
|---|---:|---:|---:|---:|---:|---:|---:|
| dentists in Austin | 10 | 7 | 4 | 0 | 6 | 0 | 61.0 |
| marketing agencies in Miami | 4 | 3 | 2 | 0 | 2 | 0 | 14.9 |
| law firms in London | 10 | 9 | 1 | 0 | 9 | 0 | 52.9 |
| accountants in Toronto | 6 | 4 | 2 | 0 | 4 | 0 | 62.0 |
| software companies in Berlin | 10 | 4 | 6 | 0 | 4 | 0 | 69.0 |
| gyms in Sydney | 10 | 4 | 6 | 0 | 4 | 0 | 63.0 |
| fintech founders | 10 | 9 | 2 | 0 | 8 | 1 | 21.8 |
| AI startup founders | 10 | 7 | 4 | 0 | 6 | 0 | 24.8 |
| rust developers in Berlin | 10 | 10 | 8 | 0 | 2 | 0 | 100.4 |
| machine learning researchers | 10 | 10 | 0 | 0 | 10 | 0 | 25.8 |
| emails at stripe.com | 3 | 3 | 1 | 2 | 0 | 0 | 3.1 |
| real estate agents in Chicago | 10 | 3 | 9 | 1 | 0 | 0 | 58.6 |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
