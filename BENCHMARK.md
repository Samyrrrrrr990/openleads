# OpenLeads live benchmark — v4.5.0 · 2026-10-10

12 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 12/12
- **Fill rate:** 88% of requested leads returned
- **Evidence-backed emails:** 50% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 0% of people failed the person-name check
- **Median time per query:** 43.4s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds |
|---|---:|---:|---:|---:|---:|---:|---:|
| dentists in Austin | 10 | 5 | 6 | 0 | 4 | 0 | 42.6 |
| marketing agencies in Miami | 4 | 3 | 2 | 2 | 0 | 0 | 21.1 |
| law firms in London | 10 | 8 | 2 | 0 | 8 | 0 | 60.3 |
| accountants in Toronto | 10 | 6 | 4 | 0 | 6 | 0 | 57.4 |
| software companies in Berlin | 10 | 3 | 7 | 0 | 3 | 0 | 51.6 |
| gyms in Sydney | 9 | 4 | 5 | 0 | 4 | 0 | 85.7 |
| fintech founders | 10 | 9 | 2 | 0 | 8 | 0 | 16.7 |
| AI startup founders | 10 | 7 | 4 | 0 | 6 | 0 | 14.2 |
| rust developers in Berlin | 10 | 10 | 7 | 0 | 3 | 0 | 99.9 |
| machine learning researchers | 10 | 10 | 0 | 0 | 10 | 0 | 23.8 |
| emails at stripe.com | 3 | 3 | 1 | 2 | 0 | 0 | 2.3 |
| real estate agents in Chicago | 10 | 3 | 9 | 0 | 1 | 0 | 43.4 |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
