# OpenLeads live benchmark — v5.0.0 · 2026-10-25

12 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 12/12
- **Fill rate:** 67% of requested leads returned
- **Evidence-backed emails:** 49% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 0% of people failed the person-name check
- **Median time per query:** 68.3s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds |
|---|---:|---:|---:|---:|---:|---:|---:|
| dentists in Austin | 4 | 2 | 2 | 0 | 2 | 0 | 77.5 |
| marketing agencies in Miami | 10 | 8 | 4 | 0 | 6 | 0 | 47.6 |
| law firms in London | 4 | 2 | 2 | 0 | 2 | 0 | 160.4 |
| accountants in Toronto | 4 | 3 | 1 | 0 | 3 | 0 | 96.8 |
| software companies in Berlin | 5 | 3 | 2 | 0 | 3 | 0 | 68.6 |
| gyms in Sydney | 4 | 1 | 4 | 0 | 0 | 0 | 81.1 |
| fintech founders | 10 | 10 | 2 | 0 | 8 | 0 | 25.1 |
| AI startup founders | 10 | 7 | 3 | 0 | 7 | 0 | 15.6 |
| rust developers in Berlin | 10 | 10 | 8 | 0 | 2 | 0 | 61.4 |
| machine learning researchers | 10 | 10 | 2 | 0 | 8 | 0 | 57.1 |
| emails at stripe.com | 4 | 3 | 2 | 2 | 0 | 0 | 4.2 |
| real estate agents in Chicago | 5 | 3 | 4 | 1 | 0 | 0 | 68.3 |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
