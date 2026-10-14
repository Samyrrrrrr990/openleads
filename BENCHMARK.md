# OpenLeads live benchmark — v4.6.1 · 2026-10-14

12 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 12/12
- **Fill rate:** 72% of requested leads returned
- **Evidence-backed emails:** 52% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 3% of people failed the person-name check
- **Median time per query:** 62.9s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds |
|---|---:|---:|---:|---:|---:|---:|---:|
| dentists in Austin | 4 | 2 | 2 | 0 | 2 | 0 | 71.2 |
| marketing agencies in Miami | 4 | 3 | 2 | 1 | 1 | 0 | 51.7 |
| law firms in London | 4 | 3 | 1 | 0 | 3 | 0 | 148.8 |
| accountants in Toronto | 4 | 3 | 1 | 0 | 3 | 0 | 64.6 |
| software companies in Berlin | 7 | 3 | 4 | 0 | 3 | 0 | 62.2 |
| gyms in Sydney | 10 | 6 | 7 | 0 | 3 | 0 | 52.3 |
| fintech founders | 10 | 9 | 3 | 0 | 7 | 1 | 22.1 |
| AI startup founders | 10 | 7 | 4 | 0 | 6 | 1 | 18.5 |
| rust developers in Berlin | 10 | 10 | 7 | 0 | 3 | 0 | 66.5 |
| machine learning researchers | 10 | 10 | 1 | 0 | 9 | 0 | 62.9 |
| emails at stripe.com | 3 | 3 | 1 | 2 | 0 | 0 | 4.0 |
| real estate agents in Chicago | 10 | 3 | 9 | 0 | 1 | 0 | 70.9 |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
