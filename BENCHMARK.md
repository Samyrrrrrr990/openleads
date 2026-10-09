# OpenLeads live benchmark — v4.5.0 · 2026-10-09

12 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 12/12
- **Fill rate:** 60% of requested leads returned
- **Evidence-backed emails:** 50% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 0% of people failed the person-name check
- **Median time per query:** 83.9s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds |
|---|---:|---:|---:|---:|---:|---:|---:|
| dentists in Austin | 4 | 2 | 2 | 0 | 2 | 0 | 80.9 |
| marketing agencies in Miami | 4 | 3 | 2 | 0 | 2 | 0 | 71.6 |
| law firms in London | 4 | 3 | 1 | 0 | 3 | 0 | 162.9 |
| accountants in Toronto | 4 | 3 | 1 | 0 | 3 | 0 | 87.2 |
| software companies in Berlin | 5 | 3 | 2 | 0 | 3 | 0 | 83.9 |
| gyms in Sydney | 3 | 1 | 3 | 0 | 0 | 0 | 92.0 |
| fintech founders | 10 | 9 | 5 | 0 | 5 | 0 | 24.9 |
| AI startup founders | 10 | 7 | 4 | 0 | 6 | 0 | 37.5 |
| rust developers in Berlin | 10 | 10 | 7 | 0 | 3 | 0 | 117.7 |
| machine learning researchers | 10 | 10 | 1 | 0 | 9 | 0 | 59.6 |
| emails at stripe.com | 3 | 3 | 1 | 2 | 0 | 0 | 3.6 |
| real estate agents in Chicago | 5 | 3 | 4 | 1 | 0 | 0 | 95.8 |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
