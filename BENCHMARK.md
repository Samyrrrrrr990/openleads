# OpenLeads live benchmark — v4.5.0 · 2026-10-11

12 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 12/12
- **Fill rate:** 74% of requested leads returned
- **Evidence-backed emails:** 53% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 0% of people failed the person-name check
- **Median time per query:** 68.8s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds |
|---|---:|---:|---:|---:|---:|---:|---:|
| dentists in Austin | 10 | 7 | 4 | 0 | 6 | 0 | 71.0 |
| marketing agencies in Miami | 4 | 3 | 2 | 2 | 0 | 0 | 23.4 |
| law firms in London | 5 | 5 | 0 | 0 | 5 | 0 | 107.3 |
| accountants in Toronto | 4 | 3 | 1 | 0 | 3 | 0 | 68.8 |
| software companies in Berlin | 10 | 3 | 7 | 0 | 3 | 0 | 73.7 |
| gyms in Sydney | 3 | 1 | 2 | 0 | 1 | 0 | 81.0 |
| fintech founders | 10 | 9 | 6 | 0 | 4 | 0 | 31.5 |
| AI startup founders | 10 | 7 | 3 | 0 | 7 | 0 | 32.6 |
| rust developers in Berlin | 10 | 10 | 7 | 0 | 3 | 0 | 88.6 |
| machine learning researchers | 10 | 10 | 0 | 0 | 10 | 0 | 27.9 |
| emails at stripe.com | 3 | 3 | 1 | 2 | 0 | 0 | 3.3 |
| real estate agents in Chicago | 10 | 3 | 9 | 1 | 0 | 0 | 57.2 |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
