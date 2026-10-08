# OpenLeads live benchmark — v4.5.0 · 2026-10-08

12 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 12/12
- **Fill rate:** 94% of requested leads returned
- **Evidence-backed emails:** 50% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 0% of people failed the person-name check
- **Median time per query:** 48.0s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds |
|---|---:|---:|---:|---:|---:|---:|---:|
| dentists in Austin | 10 | 5 | 6 | 0 | 4 | 0 | 48.0 |
| marketing agencies in Miami | 10 | 7 | 6 | 0 | 4 | 0 | 19.0 |
| law firms in London | 10 | 8 | 2 | 0 | 8 | 0 | 67.4 |
| accountants in Toronto | 10 | 4 | 6 | 0 | 4 | 0 | 55.1 |
| software companies in Berlin | 10 | 4 | 6 | 0 | 4 | 0 | 80.1 |
| gyms in Sydney | 10 | 6 | 4 | 0 | 6 | 0 | 52.4 |
| fintech founders | 10 | 9 | 2 | 0 | 8 | 0 | 32.7 |
| AI startup founders | 10 | 8 | 5 | 0 | 5 | 0 | 17.0 |
| rust developers in Berlin | 10 | 10 | 7 | 0 | 3 | 0 | 104.5 |
| machine learning researchers | 10 | 10 | 0 | 0 | 10 | 0 | 26.5 |
| emails at stripe.com | 3 | 3 | 1 | 2 | 0 | 0 | 3.7 |
| real estate agents in Chicago | 10 | 3 | 9 | 0 | 1 | 0 | 44.5 |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
