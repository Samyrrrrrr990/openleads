# Show HN

**Title** (max 80 chars):

> Show HN: OpenLeads – find people's work emails from public data, no API keys

**URL:** https://github.com/Samyrrrrrr990/openleads

**First comment** (post it right after submitting):

---

Hi HN, I built OpenLeads because every "free" lead tool I tried was a credit-limited
demo for a paid database, and the ones that really were free labelled every
`first.last@` guess as "verified".

You type who you want ("dentists in Austin", "rust developers in Berlin", "emails at
stripe.com") and it searches public sources: OpenStreetMap for local businesses, YC
and HN for startups, GitHub, OpenAlex for researchers, SEC EDGAR, Wikidata, and the
companies' own team pages. Then it works out each person's email and says how it
knows: **found** (published or server-confirmed), **pattern** (built from a real
address format seen at that company), or **guessed**.

Some things I learned building it:

- My unit tests passed while the product was broken. 300 tests, all mocking the
  network. Real queries returned page headings like "Refund Policy" as people, and
  "dentists in Austin" returned chiropractors. Now there's `openleads bench`, which
  runs 12 real queries against the live sources every night and commits the
  scoreboard to the repo: [BENCH_SUMMARY].
- Telling a name from a heading is surprisingly hard. What finally worked was
  requiring scraped names to start with a known given name (public-domain SSA data
  plus an international list), and rejecting acronyms.
- Port 25 is blocked almost everywhere, so SMTP verification usually can't run.
  Most of the confidence comes from addresses the company itself publishes, which
  reveal its email format.
- The public Overpass API is often overloaded (504s), so local search falls back to
  a mirror, then to Nominatim.

It's stdlib-only Python, runs locally (SQLite in ~/.openleads, no telemetry), and
also works as an MCP server, so Claude or Cursor can call it. You can put searches
on a schedule ("weekdays 9am") and it'll draft and send within a daily cap, with
dry-run as the default.

License is AGPL-3.0. It's free to use, including at work. There's a commercial
license if you want to embed it in a closed product.

I'd especially like to hear about queries that return bad results. Those become
benchmark cases.

---

**Replies to have ready:**

- *"Isn't this spam tooling?"* It sends nothing unless you add `--live`. It caps
  daily volume, ramps up new mailboxes, honours unsubscribes and a suppression list,
  and stops for anyone who replies. Guessed addresses are held back by default. The
  sources are public, and the responsible-use doc covers CAN-SPAM, GDPR and CASL.
- *"GDPR?"* Business contact data under legitimate interest is the usual basis for
  B2B outreach in the EU, but it's your call and your obligation. The tool doesn't
  decide that for you, and the docs say so.
- *"Why AGPL?"* So a hosted clone has to share its changes. Running it yourself
  costs nothing.
