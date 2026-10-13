---
title: My 300 unit tests passed while my lead finder returned "Refund Policy" as a person
published: false
tags: python, opensource, testing, showdev
cover_image: https://samyrrrrrr990.github.io/openleads/og.png
canonical_url:
---

<!-- For dev.to / Hashnode / Medium. Paste as Markdown, set published: true when ready. -->

I build [OpenLeads](https://github.com/Samyrrrrrr990/openleads), an open-source tool
that finds people and their work emails from public data. You type "dentists in
Austin", it searches OpenStreetMap, the companies' own team pages, and a few other
public sources, and it labels every email it returns as **found**, **pattern**, or
**guessed**.

For a few months it had a green test suite and a broken product. This is how that
happened, and the one change that fixed it.

## Every test mocked the network

OpenLeads talks to a lot of things it doesn't control: the Overpass API, GitHub,
OpenAlex, SEC EDGAR, Wikidata, and thousands of small business websites. So the
unit tests did what unit tests do. They fed in recorded responses and checked the
parsing.

300 tests. All green. Meanwhile, real searches looked like this:

- "marketing agencies in Miami" returned 20 "people", and 6 of them were page
  headings: *Refund Policy*, *Our Services*, *HSBC North America*.
- "dentists in Austin" returned chiropractors and a transport company.
- "machine learning researchers" returned nothing at all.
- "rust developers in Berlin" was still running after four minutes.

None of these were parsing bugs, so none of them could show up in a parsing test.
They were *quality* bugs: the code did exactly what it was written to do, against
data that didn't look like the fixtures.

## The fix: a benchmark against live data, every night

I added a command, `openleads bench`, that runs 12 real searches against the live
sources and scores the results:

- Did the search return anything?
- What share of the requested leads came back?
- How many "names" are junk (headings, acronyms, company names)?
- How many emails are backed by evidence, and how many are guesses?
- How long did it take?

A GitHub Actions workflow runs it every night and commits the scoreboard to the
repo as [BENCHMARK.md](https://github.com/Samyrrrrrr990/openleads/blob/main/BENCHMARK.md).
The project website reads the same JSON, so the numbers on the landing page are
last night's numbers, not a marketing claim.

The first run was humbling. The latest one: 12 of 12 searches return results, 82%
of requested leads are filled, 0% junk names, and 57% of emails are found or
built from a pattern the company really uses. The rest are labeled as guesses,
and you decide whether to send them.

## Three things the benchmark taught me

**1. Telling a name from a heading is hard.** Capitalized two-word strings on a
team page are usually names, until they're "Refund Policy". What finally worked was
requiring scraped names to start with a known given name, using public-domain
Social Security Administration data plus an international list, and rejecting
acronyms outright.

**2. SMTP verification mostly doesn't run.** Port 25 is blocked on almost every
home connection and cloud VM, so the classic "ask the mail server if this address
exists" check usually can't happen. Most real confidence comes from addresses the
company publishes itself (in commits, on its site, in `security.txt`), which reveal
its email format.

**3. Public APIs fall over.** The public Overpass API returns 504s under load, so
local search falls back to a mirror and then to Nominatim. Without a live
benchmark, I'd never have known how often that path ran.

## What I'd tell anyone with a scraper or an LLM pipeline

Your unit tests check that the code does what you wrote. They can't tell you
whether what you wrote is any good against today's data. If your product's output
depends on data you don't control, keep a small set of real queries, run them on a
schedule, and commit the scores where you'll see them change.

## Try it

```bash
pipx install "openleads[all]"
openleads find "dentists in Austin"
openleads web    # dashboard with an n8n-style workflow canvas
```

It's AGPL-3.0, runs on your machine, and needs no API keys. It also works as an MCP
server for Claude and Cursor. If you find a search that comes back wrong, post it
in [this thread](https://github.com/Samyrrrrrr990/openleads/discussions/13) and it
becomes a benchmark case.

Repo: https://github.com/Samyrrrrrr990/openleads
