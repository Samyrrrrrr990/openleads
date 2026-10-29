# Use it from Python

Everything the CLI does is one import away. The library is standard-library only,
runs locally, and shares the CLI's cache and learned email patterns
(under `~/.openleads`, or wherever `OPENLEADS_HOME` points).

```python
import openleads

leads = openleads.find("dentists in Austin", count=10)
for lead in leads:
    print(lead.email, lead.tier, lead.evidence, lead.organization)

print(leads.report.summary())
# 10/10 leads in 31.4s · local ok

leads.write("dentists.csv")        # or .json / .jsonl
```

`import openleads` stays light: the engine is only imported the first time you
call `find`, `find_email` or `verify`.

## `openleads.find(query, **options)`

Takes the same plain-English query as `openleads find` and returns a
`SearchResult` — a `list` of `Lead` objects that also carries the parsed query
and the run report.

| Option | Default | Meaning |
|---|---|---|
| `count` | `None` | How many leads to return (1–1000). Default: the number in the query ("50 fintech founders"), else 10. |
| `location` | `None` | A place, if it isn't in the words (`"Austin, TX"`). |
| `source` | `None` | Pin one source (see `openleads sources`). By default the query is routed to the sources that fit it. |
| `verified_only` | `False` | Keep only `safe`-tier (deliverable) addresses. |
| `budget` | `60` | Seconds before the search returns what it has. `0` = no limit; otherwise held to 5–3600. The budget is a real deadline: every network call is clamped to it. |
| `deep` | `False` | Slower, more thorough ground-truth harvesting. |
| `people` | `True` | Expand companies into named people from their team pages. |
| `company_profile` | `True` | Read each company's homepage (tech stack, socials, phone). |
| `use_cache` | `True` | Reuse cached lookups and save new ones. With `False` nothing is written to the cache, but each URL is still fetched only once per search. |
| `seniority` | `None` | Keep only these seniorities: a list or `"vp,director"`. Values: `owner, founder, c_suite, partner, vp, head, director, manager, senior, entry`. |
| `department` | `None` | Keep only these departments, e.g. `["sales", "marketing"]`. |
| `on_lead` | `None` | Called with each `Lead` as soon as it's found (for progress output). |

Options you pass win over what the words say, but options left at their defaults
never undo the words: `find("fintech founders, verified only")` is still
verified-only.

An unknown source or role filter raises `ValueError` with a suggestion:
`unknown source 'locl' — did you mean 'local'?`.

### `SearchResult`

* It is a `list`: index it, loop over it, `len()` it.
* `.query` — the `Query` that ran (the parsed words plus your options).
* `.report` — what happened, per source (see below).
* `.to_dicts()` / `.to_json()` — the same shape as `openleads find --format json`.
* `.write(path, fmt=None)` — `csv`, `json` or `jsonl` (`ndjson`), picked from the
  file extension unless you pass `fmt`. Returns the path.

### `Lead`

The fields of the CSV export, as attributes: `first_name`, `last_name`, `email`,
`title`, `organization`, `industry`, `employees`, `linkedin_url`, `city`,
`country`, `website`, `phone`, `seniority`, `department`, `company_size`,
`technologies`, `socials`, `description`, `source`, `vertical` — plus

* `tier` — `safe` (send), `risky` (plausible, unconfirmed) or `bad`;
* `confidence_pct` — a calibrated 0–100 deliverability likelihood;
* `evidence` — `found` (published or confirmed by the mail server), `pattern`
  (built from an address shape seen at that domain), `guessed`, or `none`;
* `reasons` — a short human explanation of the tier;
* `contact_type` — `person` (a named human) or `company` (a business or role
  address like `info@`).

### The run report

`leads.report` is a `SearchReport`:

```python
rep = leads.report
rep.summary()          # "4/10 leads in 60.8s · time budget reached · local ok · yc timeout"
rep.status_lines()     # one line per source
rep.hints()            # what to try next when a search came up short
rep.stop_reason        # count_reached | exhausted | budget | futility | max_companies
rep.dropped            # {"undeliverable": 3, "not_safe": 0, "filtered": 2}
rep.sources["local"]   # SourceReport: status, entities, expanded, leads, seconds,
                       #               fallbacks, errors, note, reason
rep.to_dict()          # JSON-ready
```

A source's `status` is one of:

| Status | Meaning |
|---|---|
| `ok` | Returned results without trouble. |
| `degraded` | Returned results, but hit errors or used a fallback (e.g. OpenStreetMap's Overpass was busy, so it used Nominatim). |
| `empty` | Answered, but had nothing for this query. |
| `failed` | Errored and returned nothing (the errors say which host and why). |
| `timeout` | Still working when the time budget ran out. |
| `skipped` | Never needed (enough leads came from the others). |

## `openleads.find_email(name, domain)`

```python
r = openleads.find_email("Ada Lovelace", "acme.com")
r.email, r.tier, r.confidence_pct, r.reasons
```

Returns an `EmailResult` with the most likely address and its evidence. Options:
`deep=False`, `use_cache=True`.

## `openleads.verify(email)`

```python
openleads.verify("ada@acme.com").tier      # "safe" | "risky" | "bad"
```

A failed DNS lookup is reported as `risky` ("couldn't check the mail server"),
never as "no mail server".

## Lower level

`openleads.engine.build_leads(query, cache=None, db=None, on_progress=None, *,
report=None)` is what `find` wraps. Build the `Query` with
`openleads.intent.build_query(text, **options)` — the same validated builder the
CLI, the dashboard and the MCP server use. `on_progress(kind, payload)` receives
`"phase"` (a message), `"lead"` (a `Lead`), `"scan"` (counts), `"source"` (a
`SourceReport`, when a source finishes) and `"report"` (the `SearchReport`, at
the end); ignore kinds you don't use.

## Environment

| Variable | Effect |
|---|---|
| `OPENLEADS_HOME` | Where the cache and database live (default `~/.openleads`). |
| `OPENLEADS_HTTP_RETRIES` | Retries per request on HTTP 429/502/503/504, timeouts and dropped connections (default `2`, max `5`). |
| `OPENLEADS_OVERPASS_URLS` | Comma-separated Overpass endpoints to use instead of the public mirrors. |
| `OPENLEADS_CONTACT` | An email or URL added to the User-Agent sent to public APIs (Nominatim, Overpass, Wikidata, SEC…), as their usage policies ask for heavy use. |
| `GITHUB_TOKEN` | Higher GitHub API limits for developer searches. |
