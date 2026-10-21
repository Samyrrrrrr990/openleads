# OpenLeads live benchmark — v5.0.0 · 2026-10-21

12 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 12/12
- **Fill rate:** 72% of requested leads returned
- **Evidence-backed emails:** 62% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 0% of people failed the person-name check
- **Median time per query:** 73.2s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds |
|---|---:|---:|---:|---:|---:|---:|---:|
| dentists in Austin | 4 | 2 | 2 | 0 | 2 | 0 | 81.2 |
| marketing agencies in Miami | 7 | 6 | 2 | 2 | 3 | 0 | 68.4 |
| law firms in London | 4 | 2 | 2 | 0 | 2 | 0 | 131.2 |
| accountants in Toronto | 4 | 3 | 1 | 0 | 3 | 0 | 83.2 |
| software companies in Berlin | 10 | 3 | 7 | 0 | 3 | 0 | 73.2 |
| gyms in Sydney | 4 | 1 | 4 | 0 | 0 | 0 | 76.7 |
| fintech founders | 10 | 9 | 5 | 0 | 5 | 0 | 31.4 |
| AI startup founders | 10 | 7 | 5 | 0 | 5 | 0 | 17.7 |
| rust developers in Berlin | 10 | 10 | 8 | 0 | 2 | 0 | 100.0 |
| machine learning researchers | 10 | 10 | 2 | 0 | 8 | 0 | 58.0 |
| emails at stripe.com | 3 | 3 | 1 | 2 | 0 | 0 | 3.1 |
| real estate agents in Chicago | 10 | 3 | 9 | 1 | 0 | 0 | 57.8 |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
