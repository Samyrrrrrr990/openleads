# OpenLeads live benchmark — v5.0.0 · 2026-10-28

12 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 11/12
- **Fill rate:** 72% of requested leads returned
- **Evidence-backed emails:** 57% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 0% of people failed the person-name check
- **Median time per query:** 52.1s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds |
|---|---:|---:|---:|---:|---:|---:|---:|
| dentists in Austin | 0 | 0 | 0 | 0 | 0 | 0 | 15.3 |
| marketing agencies in Miami | 10 | 8 | 4 | 2 | 4 | 0 | 47.6 |
| law firms in London | 4 | 3 | 1 | 0 | 3 | 0 | 117.0 |
| accountants in Toronto | 4 | 3 | 1 | 0 | 3 | 0 | 77.0 |
| software companies in Berlin | 10 | 4 | 6 | 0 | 4 | 0 | 103.2 |
| gyms in Sydney | 4 | 1 | 4 | 0 | 0 | 0 | 90.3 |
| fintech founders | 10 | 9 | 2 | 0 | 8 | 0 | 18.5 |
| AI startup founders | 10 | 7 | 5 | 0 | 5 | 0 | 16.6 |
| rust developers in Berlin | 10 | 10 | 8 | 0 | 2 | 0 | 102.7 |
| machine learning researchers | 10 | 10 | 3 | 0 | 7 | 0 | 50.8 |
| emails at stripe.com | 4 | 3 | 2 | 2 | 0 | 0 | 4.8 |
| real estate agents in Chicago | 10 | 3 | 9 | 0 | 1 | 0 | 52.1 |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
