# OpenLeads live benchmark — v5.0.0 · 2026-10-24

12 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 12/12
- **Fill rate:** 70% of requested leads returned
- **Evidence-backed emails:** 56% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 2% of people failed the person-name check
- **Median time per query:** 68.0s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds |
|---|---:|---:|---:|---:|---:|---:|---:|
| dentists in Austin | 4 | 2 | 2 | 0 | 2 | 0 | 78.1 |
| marketing agencies in Miami | 10 | 8 | 4 | 0 | 6 | 0 | 45.3 |
| law firms in London | 4 | 2 | 2 | 0 | 2 | 0 | 133.1 |
| accountants in Toronto | 4 | 3 | 1 | 0 | 3 | 0 | 89.8 |
| software companies in Berlin | 5 | 3 | 2 | 0 | 3 | 0 | 68.0 |
| gyms in Sydney | 4 | 1 | 4 | 0 | 0 | 0 | 72.3 |
| fintech founders | 10 | 10 | 4 | 0 | 6 | 1 | 18.6 |
| AI startup founders | 10 | 7 | 5 | 0 | 5 | 0 | 59.9 |
| rust developers in Berlin | 10 | 10 | 8 | 0 | 2 | 0 | 104.3 |
| machine learning researchers | 10 | 10 | 2 | 0 | 8 | 0 | 57.2 |
| emails at stripe.com | 3 | 3 | 1 | 2 | 0 | 0 | 3.9 |
| real estate agents in Chicago | 10 | 3 | 9 | 1 | 0 | 0 | 55.4 |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
