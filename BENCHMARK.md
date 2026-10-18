# OpenLeads live benchmark — v5.0.0 · 2026-10-18

12 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 12/12
- **Fill rate:** 77% of requested leads returned
- **Evidence-backed emails:** 54% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 0% of people failed the person-name check
- **Median time per query:** 60.1s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds |
|---|---:|---:|---:|---:|---:|---:|---:|
| dentists in Austin | 4 | 2 | 2 | 0 | 2 | 0 | 62.4 |
| marketing agencies in Miami | 4 | 3 | 2 | 1 | 1 | 0 | 36.5 |
| law firms in London | 4 | 3 | 1 | 0 | 3 | 0 | 67.9 |
| accountants in Toronto | 10 | 6 | 4 | 0 | 6 | 0 | 58.8 |
| software companies in Berlin | 10 | 3 | 7 | 0 | 3 | 0 | 60.1 |
| gyms in Sydney | 9 | 4 | 5 | 0 | 4 | 0 | 90.2 |
| fintech founders | 10 | 9 | 4 | 0 | 6 | 0 | 60.9 |
| AI startup founders | 10 | 7 | 6 | 0 | 4 | 0 | 17.8 |
| rust developers in Berlin | 10 | 10 | 8 | 0 | 2 | 0 | 103.7 |
| machine learning researchers | 10 | 10 | 0 | 0 | 10 | 0 | 29.1 |
| emails at stripe.com | 3 | 3 | 1 | 2 | 0 | 0 | 3.1 |
| real estate agents in Chicago | 8 | 4 | 6 | 1 | 1 | 0 | 55.3 |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
