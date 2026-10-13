# OpenLeads live benchmark — v4.5.0 · 2026-10-13

12 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 12/12
- **Fill rate:** 82% of requested leads returned
- **Evidence-backed emails:** 57% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 0% of people failed the person-name check
- **Median time per query:** 57.3s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds |
|---|---:|---:|---:|---:|---:|---:|---:|
| dentists in Austin | 4 | 2 | 2 | 0 | 2 | 0 | 61.4 |
| marketing agencies in Miami | 4 | 3 | 2 | 1 | 1 | 0 | 50.8 |
| law firms in London | 8 | 6 | 2 | 0 | 6 | 0 | 93.5 |
| accountants in Toronto | 10 | 6 | 7 | 0 | 3 | 0 | 77.8 |
| software companies in Berlin | 10 | 4 | 6 | 0 | 4 | 0 | 100.6 |
| gyms in Sydney | 10 | 6 | 7 | 0 | 3 | 0 | 57.3 |
| fintech founders | 10 | 9 | 3 | 0 | 7 | 0 | 14.4 |
| AI startup founders | 10 | 7 | 6 | 0 | 4 | 0 | 41.2 |
| rust developers in Berlin | 10 | 10 | 7 | 0 | 3 | 0 | 103.6 |
| machine learning researchers | 10 | 10 | 1 | 0 | 9 | 0 | 57.0 |
| emails at stripe.com | 3 | 3 | 1 | 2 | 0 | 0 | 3.4 |
| real estate agents in Chicago | 10 | 3 | 9 | 0 | 1 | 0 | 56.2 |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
