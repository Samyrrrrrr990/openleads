# Use it from Claude, Cursor, or any AI tool (MCP)

OpenLeads ships a [Model Context Protocol](https://modelcontextprotocol.io)
server, so an AI assistant can find and verify leads for you mid-conversation:

> "Find 10 dentists in Austin with emails we can actually send to, and draft a
> short intro for each."

…and work your CRM with you:

> "Who in my workspace is an A-grade fit and has never been contacted? Put them in
> a list called *Q4 dentists*, add them to the *Local practices* sequence, and
> make me a call task for the three most senior."

It runs locally over stdio, with no extra dependencies and no keys. Searches go
from your machine to the same public sources the CLI uses.

## Set it up

Install OpenLeads (`pip install openleads`, or `pipx install openleads`), then
add it to your client.

**Claude Code**

```bash
claude mcp add openleads -- openleads mcp
```

**Claude Desktop** (`claude_desktop_config.json`), **Cursor** (`~/.cursor/mcp.json`),
**Windsurf**, **Zed** and others use the same shape:

```json
{
  "mcpServers": {
    "openleads": { "command": "openleads", "args": ["mcp"] }
  }
}
```

No Python on the PATH? Use the npm wrapper instead:
`{"command": "npx", "args": ["-y", "openleads", "mcp"]}`.

## Tools

| Tool | What it does |
|---|---|
| `find_leads` | Plain-English search ("fintech founders", "law firms in London"). Returns people and companies with an email, a deliverability tier (`safe`/`risky`) and evidence (`found`, `pattern`, `guessed`). Takes `count`, `verified_only`, `budget_seconds`, and `save_to_list` to also save the results into a workspace list. |
| `find_email` | A name plus a company domain gives the most likely address, with evidence. |
| `verify_email` | Checks one address: `safe`, `risky` or `bad`, and why. |
| `list_sources` | Lists what OpenLeads can search. |

### Workspace tools

These read and change your saved workspace — the same data as the dashboard and
`openleads people`. They never send email: enrolling someone in a sequence queues
the steps, which then run on their own schedule inside your warmup cap.

| Tool | What it does |
|---|---|
| `search_contacts` | Search saved people by text, stage, email status, seniority, department, tag, list, minimum fit score, or never contacted. |
| `get_contact` | One person's full record: profile, company, notes, open tasks, deals, sequences and recent activity. |
| `search_companies` · `get_company` | Companies by text, technology (e.g. HubSpot), industry or stage; one company with its people and deals. |
| `list_tasks` | The follow-up queue (open, overdue, today, upcoming, done). |
| `pipeline` | Deals by stage with open, weighted, won and win-rate totals. |
| `list_sequences` | Sequences with their steps, status and reply numbers. |
| `workspace_stats` | Contacts, sends, reply rate, tasks, pipeline, fit grades and data issues at a glance. |
| `save_contacts` | Save people (e.g. `find_leads` results) into the workspace, optionally into a list with tags. Existing contacts are updated without blanking fields. |
| `add_to_list` · `set_stage` · `tag_contacts` · `add_note` | Organize people: lists, stages, tags, notes. |
| `create_task` · `complete_task` | Follow-ups with natural due dates (`tomorrow`, `+3d`, `fri`). |
| `create_deal` · `move_deal` | Open and advance deals (`12k`, `$2.5k`); winning one makes the contact a customer. |
| `enroll_in_sequence` | Add people or a whole list to a sequence; anyone it skips comes back with the reason. |

Read-only tools are annotated `readOnlyHint`, so clients that ask before running
write tools will do so for the ones that change your data.

## What the evidence means

The model sees the same honesty labels you do:

- **found**: the address was published on the web, or the mail server confirmed it.
- **pattern**: built from a pattern we saw a real address use at that domain.
- **guessed**: a common pattern with nothing confirming it. Don't send these
  without checking.

Tell your assistant to prefer `tier: safe` for anything it will email.
