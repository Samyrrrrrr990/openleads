# OpenLeads live benchmark — v5.0.0 · 2026-10-29

12 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 12/12
- **Fill rate:** 72% of requested leads returned
- **Evidence-backed emails:** 45% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 0% of people failed the person-name check
- **Median time per query:** 67.9s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds |
|---|---:|---:|---:|---:|---:|---:|---:|
| dentists in Austin | 10 | 7 | 4 | 0 | 6 | 0 | 63.9 |
| marketing agencies in Miami | 10 | 8 | 4 | 2 | 4 | 0 | 45.9 |
| law firms in London | 4 | 3 | 1 | 0 | 3 | 0 | 128.9 |
| accountants in Toronto | 4 | 3 | 1 | 0 | 3 | 0 | 78.8 |
| software companies in Berlin | 5 | 3 | 2 | 0 | 3 | 0 | 67.9 |
| gyms in Sydney | 4 | 1 | 4 | 0 | 0 | 0 | 88.2 |
| fintech founders | 10 | 9 | 1 | 0 | 9 | 0 | 42.1 |
| AI startup founders | 10 | 7 | 4 | 0 | 6 | 0 | 14.1 |
| rust developers in Berlin | 10 | 10 | 7 | 0 | 3 | 0 | 100.8 |
| machine learning researchers | 10 | 10 | 0 | 0 | 10 | 0 | 17.6 |
| emails at stripe.com | 4 | 3 | 2 | 2 | 0 | 0 | 3.7 |
| real estate agents in Chicago | 5 | 3 | 4 | 1 | 0 | 0 | 68.2 |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
