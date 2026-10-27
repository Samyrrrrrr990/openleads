# OpenLeads live benchmark — v5.0.0 · 2026-10-27

12 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 12/12
- **Fill rate:** 77% of requested leads returned
- **Evidence-backed emails:** 50% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 0% of people failed the person-name check
- **Median time per query:** 67.2s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds |
|---|---:|---:|---:|---:|---:|---:|---:|
| dentists in Austin | 10 | 7 | 4 | 0 | 6 | 0 | 60.0 |
| marketing agencies in Miami | 7 | 6 | 2 | 0 | 5 | 0 | 67.2 |
| law firms in London | 4 | 3 | 1 | 0 | 3 | 0 | 154.1 |
| accountants in Toronto | 4 | 3 | 1 | 0 | 3 | 0 | 78.1 |
| software companies in Berlin | 10 | 4 | 6 | 0 | 4 | 0 | 96.8 |
| gyms in Sydney | 4 | 1 | 4 | 0 | 0 | 0 | 93.3 |
| fintech founders | 10 | 9 | 2 | 0 | 8 | 0 | 47.1 |
| AI startup founders | 10 | 7 | 3 | 0 | 7 | 0 | 15.0 |
| rust developers in Berlin | 10 | 10 | 8 | 0 | 2 | 0 | 107.3 |
| machine learning researchers | 10 | 10 | 2 | 0 | 8 | 0 | 57.0 |
| emails at stripe.com | 3 | 3 | 1 | 2 | 0 | 0 | 3.9 |
| real estate agents in Chicago | 10 | 3 | 9 | 1 | 0 | 0 | 55.7 |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
