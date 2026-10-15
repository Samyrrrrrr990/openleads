# The workspace: people, companies, lists, tasks and deals

Everything you find, import or add lands in one local workspace — the CRM side of
OpenLeads. It's the same data in the dashboard (`openleads web`), the terminal
(`openleads people`, `openleads tasks`, …) and your AI assistant (the
[MCP workspace tools](./mcp.md)). It lives in `~/.openleads/openleads.db`, a
SQLite file on your machine.

```bash
openleads demo          # try it first on an invented workspace (your data is untouched)
```

## People

Every contact has the fields you'd expect from Apollo — name, title, company,
email with its **tier** (safe / risky) and **evidence** (found / pattern /
guessed), phone, LinkedIn, location — plus what OpenLeads works out for you:

- **Seniority** (owner, founder, C-suite, partner, VP, head, director, manager,
  senior, entry) and **department** (sales, marketing, engineering, …) from the
  title.
- **Fit score**, 0–100 with an **A–D grade**, from your ideal-customer model (see
  [ICP scoring](#icp-scoring)).
- **Stage**, **tags**, **lists**, **notes**, **tasks**, **deals**, the
  **sequence** they're in, and a **timeline** of everything that happened.

The People page is a filterable table: facets with live counts (stage, email
status, evidence, ICP grade, seniority, department, industry, company size, tech
stack, location, tags, lists, sequence, email activity, last contacted, phone,
LinkedIn), free-text search, sortable and configurable columns, and bulk actions
on a selection or on **every row matching the filters** — add to a list, add to a
sequence, set stage, tag, assign an owner, export, write emails, mark do-not-contact
or delete. Save any filter combination as a **saved search**.

```bash
openleads people                                   # most recently updated
openleads people dental --fit A --never-contacted
openleads people --stage interested --json
openleads people show jane@acme.com                # the full record
openleads people stage jane@acme.com --to meeting
openleads people tag jane@acme.com --add vip,q4
openleads people note jane@acme.com "Wants pricing for 20 seats"
```

### Stages

| Stage | Moves here automatically when… |
|---|---|
| New | the contact is added |
| Approaching | the first email is sent |
| Replied | a reply arrives (with IMAP connected) |
| Interested · Meeting booked · Customer | you set it (or a deal is won → Customer) |
| Not interested · Unresponsive | you set it, or a sequence finishes with no reply (Unresponsive) |
| Do not contact | they unsubscribe, or you mark them |
| Bad data | the email bounces |

Automatic moves never drag a contact backwards: a follow-up sent to someone you
marked *Interested* leaves them *Interested*. A reply, bounce or unsubscribe also
takes the person out of any active sequence.

## Companies

Companies (accounts) are created from your contacts' domains and filled in from
their homepage on demand: name, description, industry, headcount band, founded
year, phone, address, social profiles and the **tech stack** their site runs
(100+ technologies across 30 categories — HubSpot, Shopify, Stripe, Intercom,
WordPress, …). Filter companies by technology, industry, size, location and stage,
and open one to see its people, deals, tasks and notes.

```bash
openleads companies --tech HubSpot
openleads companies show acme.com
openleads company acme.com            # live lookup of any domain, not just saved ones
```

Account stages: prospect, engaged, opportunity, customer, churned, disqualified.

## Lists and tags

**Lists** are static groups of people (or companies) you build from searches,
selections and imports, then work as a unit: open one in the People table, put it
in a sequence, export it. **Tags** are free-form labels on people.

```bash
openleads lists create "Q4 dentists"
openleads lists add "Q4 dentists" --where dental          # everyone matching a search
openleads lists add "Q4 dentists" jane@acme.com bob@beta.io
openleads lists show "Q4 dentists"
```

## Importing a CSV

**Import & enrich → Import CSV** (or `openleads import`) takes an export from
Apollo, HubSpot, Salesforce, LinkedIn Sales Navigator or any spreadsheet. Columns
map themselves from 100+ header spellings; you can change any of them and see real
values under each. Existing contacts are matched by email and **updated without
blanking anything**. Rows with a name and a company but no email can go straight
to the email finder.

```bash
openleads import apollo-export.csv --preview            # just show the mapping
openleads import apollo-export.csv --list "Apollo import" --tags apollo \
    --missing-out missing.csv
openleads enrich missing.csv                             # find the emails it didn't have
```

## ICP scoring

Describe your ideal customer as points in **Settings → ICP scoring**: seniority,
department, industry, company size, technologies, title keywords, location and
reachability (verified email, phone, LinkedIn). Every contact gets a 0–100 fit
score — **A** 75+, **B** 55+, **C** 35+, **D** below — and the editor previews how
many grades would change and who the best matches are *before* you save. Each
contact's record explains its score line by line.

## Tasks

Calls, emails, LinkedIn touches and to-dos. Sequence steps that need a human
become tasks on their due date; completing one moves that contact on to their next
step. The Tasks page groups work into Overdue, Today, Upcoming and No date, and
**Start queue** works through everything due one at a time, with the contact's
details, a note box, and keyboard shortcuts (Enter done, S skip, Z snooze).

```bash
openleads tasks --bucket today
openleads tasks add "Call Jane about pricing" --contact jane@acme.com --kind call --due tomorrow
openleads tasks done 12
openleads tasks snooze 13 --due +3d
```

## Deals

A drag-and-drop pipeline: Qualify (10%), Meeting (25%), Proposal (50%),
Negotiation (75%), Won, Lost. The board shows each stage's value and
probability-weighted value; the header shows open pipeline, weighted forecast, won
and win rate. Winning a deal marks its contact and company as customers.

```bash
openleads deals
openleads deals add "Acme — annual plan" --amount 12k --contact jane@acme.com
openleads deals move 3 proposal
openleads deals won 3
```

## Activity and data health

**Activity** is the workspace-wide feed — sends, replies, stage changes, notes,
tasks, deal moves, list and sequence changes, searches and imports — grouped by
day and filterable by what happened and by record type.

**Data health** lists what to fix before you send: unverified and guessed emails,
bounces, missing titles, phones and LinkedIn, untouched contacts and unprofiled
companies, each one click from the matching People filter. It also finds **duplicate
people** (the same person at the same company under two addresses) so you can pick
the record to keep and merge — tags, lists, notes, tasks, deals, sequences and
history move onto it.

```bash
openleads stats            # the workspace at a glance
openleads dedupe           # list duplicates
openleads dedupe --merge   # merge each group into its best record
```

## Exporting and backups

Export any selection or filter from People as CSV, JSON, or in **Apollo** or
**HubSpot** import format, or push it to Google Sheets, Notion, Airtable or a
webhook. From the terminal:

```bash
openleads lists export "Q4 dentists" -f hubspot -o q4.csv
openleads find "…" -f apollo
openleads export
```

**Settings → Data & backup** (or `openleads backup`) takes a consistent snapshot
of the whole workspace — safe while sequences are running — into
`~/.openleads/backups/`. To restore, stop OpenLeads and copy a backup over
`~/.openleads/openleads.db`.
