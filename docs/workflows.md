# Workflows: recipes as a canvas

A **workflow** is a recipe drawn as a row of nodes, the way n8n or Zapier draw an
automation. Each node is one step of the pipeline, and clicking a node edits that
step. Nothing about the engine changes: a workflow is saved as an ordinary recipe,
so `openleads recipe run <name>` and the scheduler run it exactly the same way.

```bash
openleads web        # then open Workflows in the sidebar
```

## The nodes

| Node | What it does | Settings |
|---|---|---|
| **Trigger** | When the workflow runs | A schedule in plain English or cron (`weekdays 09:00`, `every 2h`, `0 9 * * 1-5`), or manual only |
| **Find leads** | Searches the sources that fit your sentence | Audience (the sentence) and how many leads |
| **Verify** | Scores every address and branches on the tier | Safe only, or safe and risky |
| **Write** | Drafts a plain-text email per safe lead | What you are offering, in one line |
| **Send** | Sends inside your warmup cap | On or off, and whether to start the follow-up sequence |
| **Review** | Holds risky leads so nothing is sent by accident | Always on |
| **Export** | Pushes the leads somewhere else | CSV, JSON, Google Sheets, a webhook (n8n, Zapier, Make), Notion, or Airtable |

Nodes that are switched off are drawn dashed, and the run skips them.

## Build one

1. Open **Workflows** and click **New workflow**.
2. Click **Find leads** and type who you want, for example `marketing agencies in Miami`.
3. Click **Trigger** and type a schedule, or leave it on manual.
4. Click **Write** and describe your offer in one line.
5. Leave **Send** off for the first few runs. Turn it on once the drafts look right.
6. Click **Save**.

## Test it

**Test run** executes the whole workflow as a dry run. The nodes light up as each
step finishes, the counts appear on each node, and the run log shows every phase.
No email is sent during a test run, even with **Send** switched on.

Scheduled runs are real runs. If **Send** is on, the scheduler sends inside your
daily cap. Install the scheduler once with:

```bash
openleads schedule on
```

See [Timed runs](timed-runs.md) for how schedules are checked and what happens when
your laptop was asleep.

## Push leads into n8n or Zapier

Set **Export** to `webhook` and paste your n8n or Zapier webhook URL as the target.
Every run POSTs the leads as newline-delimited JSON, so the rest of your automation
can pick them up from there.

> **Note:** the dashboard only listens on `127.0.0.1`. A webhook export is the one
> place where lead data leaves your machine, and only to the URL you typed.
