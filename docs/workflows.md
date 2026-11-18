# Workflows

A **workflow** is an automation drawn as a graph, the way n8n draws one: a trigger
starts it, nodes find or load leads, filters route them, and outreach, workspace
and export nodes act on them. Leads travel along the connections as *items*, one
lead per item, so you can see exactly how many reached each step.

```bash
openleads web        # then open Workflows in the sidebar
openleads workflow templates
openleads workflow new miami --from local-business-outreach
```

Everything runs on your machine. A **test run** never sends, exports, notifies or
changes your workspace, so you can try any workflow safely.

## The editor

Open **Workflows** in `openleads web`. Your workflows are listed on the left, each
with a dot (green when it's on, amber when emails wait for approval) and when it
last ran. Pick one, or start a new one.

**Describe it.** Type what should happen and when, in a sentence, in the box at
the bottom: *every weekday at 9 find 20 dentists in Toronto, write emails and send
them*. A new workflow fills in at once. On one that already has steps, you get the
proposed steps first, and **Use this** swaps them in. Nothing is saved until you
press Save. The reader understands triggers (a schedule, *when someone replies*,
*when new leads come in*), where people come from (*find 20 …*, *people in list
X*, *people tagged X*) and the steps you name, in the order you name them. What it
can't place, it leaves out.

**Steps** is the workflow read top to bottom, the way a run walks it. Branches
(a split by tier, a filter) are indented under the step that splits, labelled with
the branch they take. Click a step to open its settings on the right. Hover a step
to add one after it or delete it.

**Canvas** draws the same workflow as boxes and wires, for wiring branches by hand:

| Do this | How |
|---|---|
| Add a step | **Add step**, or press `Tab`, then search. With a step selected, the new one goes after it and is connected. |
| Connect two steps | Drag from an output port (the dot on a step's right edge) onto another step. Drop on empty canvas to pick the next step from the list. |
| Move, pan, zoom | Drag a step. Drag the empty canvas, or scroll. `⌘`/`Ctrl` + scroll zooms; the fit button or `Shift+1` frames the whole graph. |
| Delete | Select a step or a connection and press `Delete`. |

In both views:

| Do this | How |
|---|---|
| Undo, redo | `⌘Z` and `⌘⇧Z` (`Ctrl+Z`, `Ctrl+Y`), or the arrows in the header. A burst of typing in one field, one drag, or one described workflow is a single undo step, and the button says what it will undo. |
| Save | **Save** or `⌘S`. Problems (a missing audience, a loop, a Send with no Write before it) are listed under the step they belong to. |
| Test run | **Test** or `⌘↵`. |

### Test run and run history

**Test** runs the workflow as a dry run, saved or not, and streams progress: each
step shows a spinner and a running count while it works, then *items in → items
out* and how long it took. The run's log reads underneath, and **Earlier runs**
lists the last few. A test run never sends, exports, notifies or changes your
workspace.

### Activate, live, pause

- **On** (the switch in the header) lets the workflow's triggers fire on the scheduler. Install the
  scheduler once with `openleads schedule on`; see [Timed runs](timed-runs.md).
- **Send for real on scheduled runs** decides what Send does on those runs. Off
  (the header says *Emails wait for approval*), drafts wait on Today. On, it
  sends inside your warm-up cap, suppression list and business hours.
- **Paused** workflows don't fire. Items waiting in a Wait step stay parked and
  continue once you activate the workflow again.

### Copy one

In the classic editor (`/classic/`, or `openleads web --classic`), **Duplicate**
opens an unsaved copy of the current workflow, including your latest
edits. The name starts with `<name>-copy`; if that is taken it uses `<name>-copy-2`,
then `-3`, and so on. An untitled workflow becomes `workflow-copy`. The original
stays unchanged, and the copy starts with no run history. Duplicating doesn't save
or run anything, and is unavailable while a save or test run is in progress.

## Node catalog

Items are lead dicts: email, name, title, organization, domain, tier, evidence,
confidence, fit score, stage, seniority, industry, phone and so on, the same
fields `openleads find --format json` prints.

### Triggers

| Node | What it does |
|---|---|
| **Manual** | Runs when you press Test run, run it from the CLI, or call it over MCP. |
| **Schedule** | Runs on a schedule: `weekdays 9am`, `every 2h`, `mon,wed 14:00`, or cron like `0 9 * * 1-5`. |
| **New leads** | Searches on a schedule and passes on only leads at companies it hasn't seen before (a watcher inside a workflow). The first real run remembers everything it finds. |
| **Reply received** | Fires for contacts who replied since the last run. It can scan your inbox first (IMAP); a run with no replies ends quietly and isn't logged. |

### Leads

| Node | What it does | Settings |
|---|---|---|
| **Find leads** | Searches the sources that fit your sentence, verifies every address and saves the leads to People. | Audience, count, deliverable only, location, industry, job title, seniority |
| **Load contacts** | Pulls contacts already in your workspace. | Stage, tag, list, minimum fit, last emailed (never, ever, more than N days ago), limit |
| **Enrich CSV or list** | Finds and verifies emails for people you already know. | Rows from incoming items, a CSV file or a list; deep search |
| **Look up company** | Reads each company's homepage once: industry, size, phone, socials, tech stack. | Companies per run |
| **Verify emails** | Re-checks each address and updates its tier and confidence. | Skip ones that already have a tier |

### Logic

| Node | Outputs | What it does |
|---|---|---|
| **Filter (if)** | *true*, *false* | Conditions on lead fields: tier, evidence, fit grade or score, email confidence, seniority, department, stage, industry, title, company, country, city, size, source, tags, has a phone, has LinkedIn, contacted before. Match all or any. |
| **Split by tier** | *safe*, *risky*, *bad* | Routes each lead by its email tier. |
| **Skip contacted** | | Drops duplicates, suppressed and do-not-contact addresses, anyone emailed (ever, or in the last N days), anyone in a sequence, and optionally all but one lead per company. |
| **Limit** | | Keeps the first N, optionally the best first by fit or email confidence. |

### Outreach

| Node | What it does |
|---|---|
| **Write email** | Drafts a short, plain-text, spam-checked email for each lead with an address, with your AI key when one is set, or from a saved template. |
| **Wait** | Holds items for days (and hours), optionally until business hours. Items wait in the database, so nothing needs to stay open: the scheduler wakes them on its next run, and anyone who replied, bounced or opted out meanwhile is dropped. |
| **Send** | Sends each draft from your mailbox. It always respects the warmup cap and suppression list, previews unless the run is live, and live sends outside business hours wait for the next send window. Needs a Write email before it. |

### Workspace

| Node | What it does |
|---|---|
| **Add to list** | Adds each contact to a people list, creating the list if needed. |
| **Enroll in sequence** | Enrolls each contact in a sequence; the sequence's own rules apply. |
| **Set stage** | Moves each contact to a stage. |
| **Create task** | One task per contact: call, email, LinkedIn or to-do. Titles can use `{{first_name}}`, `{{company}}`, `{{title}}`. Due: `now`, `today`, `tomorrow`, `+3d`, `mon` or a date. |
| **Tag** | Adds or removes tags. |

### Output

| Node | What it does |
|---|---|
| **Export** | CSV, JSON or NDJSON file, Google Sheets (CSV), a webhook (n8n, Zapier, Make), Notion, Airtable or HubSpot. Test runs never export. |
| **Notify** | A desktop notification, a JSON POST to a webhook (Slack, Discord, ntfy), or both. `{count}` and `{workflow}` fill in. |

Every node has **If it fails**: *Stop the run* (default), or *Continue with other
branches*, which marks the run as partial and lets unrelated branches finish.

## Templates

| Template | What it does |
|---|---|
| `local-business-outreach` | Weekday mornings: find local businesses, skip anyone already emailed, keep one per company, write and send to the safe ones, list the risky ones for review. |
| `founder-outreach` | Find founders, keep the decision makers, email them and queue a LinkedIn task for the next day. |
| `inbound-reply` | On a reply: good-fit contacts move to Interested and get a call task today; others get tagged. |
| `weekly-digest-sheets` | Every Monday: companies you haven't seen before, looked up, written to a Sheets-ready CSV, with a notification. |
| `re-engage-unresponsive` | Weekly: contacts quiet for 30+ days get a check-in; no reply in 5 days becomes a call task. |
| `enrich-csv-hubspot` | By hand: enrich a CSV, push safe contacts to HubSpot, list the rest for review. |
| `drip-with-follow-up` | Find, email, wait three business days, then a call or LinkedIn task for anyone who didn't reply. |

New workflows from templates start paused and not live.

## From the terminal

```bash
openleads workflow list                         # workflows and recipes
openleads workflow show miami                   # nodes in run order, problems
openleads workflow run miami                    # test run: nothing is sent
openleads workflow run miami --live             # real run: Send sends
openleads workflow export miami > miami.json
openleads workflow import miami.json --name miami-2   # imports arrive paused
openleads workflow activate miami               # or: pause
openleads workflow runs miami                   # recent runs with counts
openleads runs                                  # all scheduled jobs, workflows included
```

`openleads drip` (what the scheduler runs) wakes due Wait items and fires the
triggers of active workflows. A drip without `--live` test-runs them and leaves
waiting items where they are.

## Recipes are workflows too

Every recipe from `openleads recipe add` appears in the list as the graph it is:
Schedule → Find leads → Split by tier → Write email → Send, with Export and the
risky branch when the recipe has them. Recipes keep running exactly as before, and
`openleads recipe …` still works. Editing that graph saves back to the recipe; add
a step a recipe can't express and saving turns it into a full workflow (keeping
when it last ran, so it doesn't fire twice).

## Over MCP

AI assistants connected with `openleads mcp` get `list_workflows` and
`run_workflow`. `run_workflow` is a test run unless it is called with
`mode: "run"`, and it only sends with `live: true` as well.

## The API behind the editor

The dashboard uses `/api/workflows` (list), `/api/workflows/get`, `/catalog`,
`/templates`, `/runs`, `/run`, `/export`, and POSTs to `/save`, `/validate`,
`/delete`, `/flags`, `/new`, `/import`, `/draft` (a sentence in, an unsaved
graph out) and `/run` (which streams NDJSON node events). They follow the dashboard's rules: loopback only, JSON bodies only, and
cross-site requests are refused. Only saved workflows can run for real.

> **Note:** the dashboard only listens on `127.0.0.1`. Export, Notify and
> webhook steps are the places where lead data leaves your machine, and only to
> the destinations you configured.
