# Finding leads — the federated engine

In v4, you don't pick a data source. You describe who you want, and OpenLeads
**federates** the query across the public sources that fit it, finds the people
behind each company, verifies their email, and merges the results. This is how the
big tools feel like "one box that just works" — done free, keyless, and locally.

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

## From companies to people

Many sources return *companies* (a name + a domain) rather than people. OpenLeads
turns those into contactable humans by reading the company's own
`/team`, `/about`, and `/leadership` pages and extracting `(name, title)` pairs —
JSON-LD `Person` objects plus conservative name/role heuristics. Each discovered
person then goes through the [email waterfall](./how-it-works.md). Disable this with
`--no-people` to keep company-level results (and any published role addresses).

## The sources

Every source is keyless. A token (e.g. `GITHUB_TOKEN`) only raises a rate limit.

| Source | Vertical |
|---|---|
| `local` | Local businesses by category + city, via OpenStreetMap/Overpass — agencies, clinics, firms, gyms, salons, restaurants, shops. Global. |
| `yc` | Startup founders from the open Y Combinator dataset. |
| `hn` | Companies hiring now, from Hacker News "Who is hiring" (often with apply emails). |
| `companies` | Companies by industry + country with real websites, via Wikidata SPARQL. |
| `edgar` | US public companies by keyword, from SEC EDGAR. |
| `github` | Contactable developers via the keyless GitHub API. |
| `openalex` | Researchers & academics, via OpenAlex. |
| `npi` | US doctors & healthcare providers, via the NPI registry. |
| `domains` | Hunter-style: real published emails for any domain you name. |

`openleads sources` lists them; `openleads sources info <name>` shows one. You can
add your own by dropping a `*.py` file in `~/.openleads/sources/` — see
[Add a source](./sources.md).

## Bring your own list — enrichment

Already have names, companies, or domains? Run the same waterfall over your list:

```bash
openleads enrich my_list.csv -o enriched.csv
```

Headers are matched forgivingly (`First Name`, `company`, `Domain`, `Email`, …).
A row with an email is verified; a row with a name + domain is resolved and
verified; a row with only a domain is harvested + expanded into people. Every row
comes back tiered (`safe`/`risky`/`bad`) and is saved to your local CRM.

## Make it hands-free — recipes & watchers

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
```

`csv` · `json` · `ndjson` · `sheets` · `webhook` are keyless; `notion` and
`airtable` light up once you set their token in `openleads config`.

---

Next: [Email engine](./how-it-works.md) · [Deliverability](./deliverability.md) ·
[Automation & assistant](./automation.md) · [Web dashboard](./web.md).
