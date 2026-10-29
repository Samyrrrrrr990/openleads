# Finding leads: the federated engine

In v4, you don't pick a data source. You describe who you want, and OpenLeads
**federates** the query across the public sources that fit it, finds the people
behind each company, verifies their email, and merges the results. This is how the
big tools feel like "one box that just works", done free, keyless, and locally.

```bash
openleads find "marketing agencies in Miami"
openleads find "fintech founders, verified only"
openleads find "dentists in Austin"
openleads find "rust developers in Berlin"
```

## How a query is routed

The planner reads the *shape* of your request:

| Your query looks like… | Federates across |
|---|---|
| a place + a business category ("agencies in Miami", "law firms in London") | `local` (OpenStreetMap) |
| founders / startups ("fintech founders", "YC companies") | `yc` + `hn` |
| an industry / companies ("video game companies in Japan") | `companies` (Wikidata) + `edgar` |
| developers ("rust developers") | `github` |
| researchers ("ML researchers") | `openalex` |
| doctors / clinics ("dentists in Austin") | `npi` + `local` |
| a typed domain ("emails at stripe.com") | `domains` |

Streams are interleaved so results stay diverse, then de-duplicated by
`(domain, person)`. You can always pin one source with `--source <name>` (or
`/source` in chat), which skips federation entirely.

## Time budget, output and "why so few?"

`--budget SECONDS` (default 90, `0` = no limit) is a real deadline: every network
call is clamped to it, and when it runs out the search returns what already
finished instead of waiting on slow sites. Late in the budget, company expansion
keeps published addresses and skips team-page crawls. Transient failures
(HTTP 429/5xx, timeouts) are retried briefly; OpenStreetMap queries move on to
the next public Overpass mirror, then to Nominatim.

```bash
openleads find "agencies in Miami" --format json | jq '.[].email'   # stdout is pure JSON
openleads find "agencies in Miami" -q -o leads.csv                  # no progress output
openleads find "dentists in Austin" --explain                       # plan, reasons, report
openleads find "dentists in Austin" --report run.json               # the report as JSON
```

* With `--format json`/`ndjson` (`jsonl`) or `-o -`, the leads go to stdout and
  all progress goes to stderr, so pipes get clean data. `-q` hides progress.
* `--explain` prints how the query was understood, which sources run and why, and
  the per-source report at the end.
* Whenever a search returns fewer leads than asked, it prints one status line per
  source (`ok`, `degraded`, `empty`, `failed`, `timeout`, `skipped`) and a hint —
  e.g. "OpenStreetMap is busy right now — re-run in a minute or raise --budget".
  `--report FILE` saves the same report as JSON.
* Common cities ("Austin, TX", "NYC", "London", "München", ~190 metros) are placed
  on the map offline; anything else is geocoded with OpenStreetMap's Nominatim.

The same report is available from Python (`openleads.find(...).report`, see
[Python API](./python-api.md)) and from the MCP server.

## From companies to people

Many sources return *companies* (a name + a domain) rather than people. OpenLeads
turns those into contactable humans by reading the company's own
`/team`, `/about`, and `/leadership` pages and extracting `(name, title)` pairs: 
JSON-LD `Person` objects plus conservative name/role heuristics. Each discovered
person then goes through the [email waterfall](./how-it-works.md). Disable this with
`--no-people` to keep company-level results (and any published role addresses).

## The sources

Every source is keyless. A token (e.g. `GITHUB_TOKEN`) only raises a rate limit.

| Source | Vertical |
|---|---|
| `local` | Local businesses by category + city, via OpenStreetMap/Overpass: agencies, clinics, firms, gyms, salons, restaurants, shops. Global. |
| `yc` | Startup founders from the open Y Combinator dataset. |
| `hn` | Companies hiring now, from Hacker News "Who is hiring" (often with apply emails). |
| `companies` | Companies by industry + country with real websites, via Wikidata SPARQL. |
| `edgar` | US public companies by keyword, from SEC EDGAR. |
| `github` | Contactable developers via the keyless GitHub API. |
| `openalex` | Researchers & academics, via OpenAlex. |
| `npi` | US doctors & healthcare providers, via the NPI registry. |
| `domains` | Hunter-style: real published emails for any domain you name. |

`openleads sources` lists them; `openleads sources info <name>` shows one. You can
add your own by dropping a `*.py` file in `~/.openleads/sources/`. See
[Add a source](./sources.md).

## Bring your own list: enrichment

Already have names, companies, or domains? Run the same waterfall over your list:

```bash
openleads enrich my_list.csv -o enriched.csv
```

Headers are matched forgivingly (`First Name`, `company`, `Domain`, `Email`, …).
A row with an email is verified; a row with a name + domain is resolved and
verified; a row with only a domain is harvested + expanded into people. Every row
comes back tiered (`safe`/`risky`/`bad`) and is saved to your local CRM.

## Make it hands-free: recipes & watchers

A **recipe** saves an ICP + message + schedule + export and runs itself:

```bash
openleads recipe add growth "marketing agencies in Miami" \
  --at 09:00 --send --context "our local-SEO service" --export sheets
openleads recipe run growth          # dry-run now
openleads schedule --at 09:00        # arm the on-device daily drip
```

The daily drip syncs your inbox (replies/bounces stop sequences), runs due
recipes, fires watchers, then sends follow-ups. A **watcher** delivers only
*new* matches each run:

```bash
openleads watch add new-miami "marketing agencies in Miami" --sink webhook
```

## Export anywhere

```bash
openleads export csv --target leads.csv
openleads export sheets                       # a Google-Sheets-ready CSV + import hint
openleads export webhook --target https://hooks.example.com/leads
openleads export notion                       # needs notion_token + notion_database_id
openleads export airtable                     # needs airtable_token + airtable_base
openleads export hubspot                      # needs hubspot_token; creates/updates contacts by email
```

`csv` · `json` · `ndjson` · `sheets` · `webhook` are keyless; `notion`, `airtable`
and `hubspot` light up once you set their token in `openleads config`.

For HubSpot, set `hubspot_token` in Settings → Integrations, or provide it through
`HUBSPOT_TOKEN`. Use a private app token with `crm.objects.contacts.write`. No token
means a clear error and no network request. Every lead needs an email; missing
emails reject the export before any contacts are written.

HubSpot exports name, company, job title, phone, website, city and country when
present. Existing contacts are matched by email and only populated fields are
updated; blank fields do not clear CRM values, and an existing primary email is
left alone. New contacts receive the supplied email. Exports stop on the first
failed request and report the number of confirmed contacts. A timeout or invalid
response can leave the last write unconfirmed; check HubSpot before retrying.
Rate limits are surfaced without automatic retries.

---

Next: [Email engine](./how-it-works.md) · [Deliverability](./deliverability.md) ·
[Automation & assistant](./automation.md) · [Web dashboard](./web.md).
