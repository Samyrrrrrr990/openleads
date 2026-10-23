# OpenLeads live benchmark — v5.0.0 · 2026-10-23

12 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 12/12
- **Fill rate:** 72% of requested leads returned
- **Evidence-backed emails:** 48% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 0% of people failed the person-name check
- **Median time per query:** 64.9s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds |
|---|---:|---:|---:|---:|---:|---:|---:|
| dentists in Austin | 10 | 6 | 4 | 0 | 6 | 0 | 58.8 |
| marketing agencies in Miami | 7 | 6 | 2 | 2 | 3 | 0 | 64.9 |
| law firms in London | 4 | 2 | 2 | 0 | 2 | 0 | 90.0 |
| accountants in Toronto | 4 | 3 | 1 | 0 | 3 | 0 | 64.9 |
| software companies in Berlin | 10 | 4 | 6 | 0 | 4 | 0 | 99.0 |
| gyms in Sydney | 4 | 1 | 3 | 0 | 1 | 0 | 62.8 |
| fintech founders | 10 | 10 | 2 | 0 | 8 | 0 | 16.9 |
| AI startup founders | 10 | 7 | 4 | 0 | 6 | 0 | 13.7 |
| rust developers in Berlin | 10 | 10 | 8 | 0 | 2 | 0 | 102.5 |
| machine learning researchers | 10 | 10 | 0 | 0 | 10 | 0 | 38.1 |
| emails at stripe.com | 3 | 3 | 1 | 2 | 0 | 0 | 4.0 |
| real estate agents in Chicago | 5 | 3 | 4 | 1 | 0 | 0 | 68.0 |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
