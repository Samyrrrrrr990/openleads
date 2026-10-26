# OpenLeads live benchmark — v5.0.0 · 2026-10-26

12 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 12/12
- **Fill rate:** 80% of requested leads returned
- **Evidence-backed emails:** 58% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 0% of people failed the person-name check
- **Median time per query:** 60.0s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds |
|---|---:|---:|---:|---:|---:|---:|---:|
| dentists in Austin | 10 | 7 | 4 | 0 | 6 | 0 | 57.0 |
| marketing agencies in Miami | 10 | 8 | 4 | 1 | 5 | 0 | 46.3 |
| law firms in London | 4 | 3 | 1 | 0 | 3 | 0 | 109.4 |
| accountants in Toronto | 4 | 3 | 1 | 0 | 3 | 0 | 73.9 |
| software companies in Berlin | 10 | 4 | 6 | 0 | 4 | 0 | 93.8 |
| gyms in Sydney | 4 | 1 | 4 | 0 | 0 | 0 | 85.5 |
| fintech founders | 10 | 9 | 3 | 0 | 7 | 0 | 29.9 |
| AI startup founders | 10 | 7 | 8 | 0 | 2 | 0 | 20.9 |
| rust developers in Berlin | 10 | 10 | 8 | 0 | 2 | 0 | 100.4 |
| machine learning researchers | 10 | 10 | 2 | 0 | 8 | 0 | 57.7 |
| emails at stripe.com | 4 | 3 | 2 | 2 | 0 | 0 | 4.5 |
| real estate agents in Chicago | 10 | 3 | 9 | 1 | 0 | 0 | 60.0 |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
