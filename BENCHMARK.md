# OpenLeads live benchmark — v5.5.0 · 2026-11-15

13 real queries, 10 leads asked for each, run against the live public sources (no mocks).

- **Queries with results:** 13/13
- **Fill rate:** 95% of requested leads returned
- **Evidence-backed emails:** 53% (published, server-confirmed, or built from a pattern seen at that domain)
- **Junk names:** 4% of people failed the person-name check
- **Median time per query:** 38.9s

| Query | Leads | People | Found | Pattern | Guessed | Junk | Seconds | Notes |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| dentists in Austin | 10 | 3 | 8 | 0 | 2 | 0 | 52.1 |  |
| marketing agencies in Miami | 10 | 8 | 4 | 0 | 6 | 0 | 35.0 |  |
| law firms in London | 10 | 7 | 3 | 0 | 7 | 0 | 38.9 |  |
| accountants in Toronto | 10 | 7 | 3 | 0 | 7 | 0 | 38.9 |  |
| software companies in Berlin | 10 | 0 | 10 | 0 | 0 | 0 | 18.6 |  |
| gyms in Sydney | 10 | 2 | 8 | 0 | 2 | 0 | 47.9 |  |
| fintech founders | 10 | 10 | 1 | 0 | 9 | 3 | 15.0 |  |
| AI startup founders | 10 | 7 | 3 | 0 | 7 | 0 | 12.0 |  |
| rust developers in Berlin | 10 | 10 | 8 | 0 | 2 | 0 | 52.3 |  |
| machine learning researchers | 10 | 10 | 0 | 0 | 10 | 0 | 25.5 |  |
| emails at stripe.com | 4 | 3 | 2 | 2 | 0 | 0 | 4.5 | sources ran out of results |
| real estate agents in Chicago | 10 | 6 | 6 | 1 | 3 | 0 | 55.2 |  |
| plumbers in Denver | 10 | 3 | 7 | 0 | 3 | 0 | 52.1 |  |

Reproduce: `openleads bench`. Numbers vary run to run because the sources are live.
