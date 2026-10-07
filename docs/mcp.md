# Use it from Claude, Cursor, or any AI tool (MCP)

OpenLeads ships a [Model Context Protocol](https://modelcontextprotocol.io)
server, so an AI assistant can find and verify leads for you mid-conversation:

> "Find 10 dentists in Austin with emails we can actually send to, and draft a
> short intro for each."

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
| `find_leads` | Plain-English search ("fintech founders", "law firms in London"). Returns people and companies with an email, a deliverability tier (`safe`/`risky`) and evidence (`found`, `pattern`, `guessed`). Takes `count`, `verified_only` and `budget_seconds`. |
| `find_email` | A name plus a company domain gives the most likely address, with evidence. |
| `verify_email` | Checks one address: `safe`, `risky` or `bad`, and why. |
| `list_sources` | Lists what OpenLeads can search. |

## What the evidence means

The model sees the same honesty labels you do:

- **found**: the address was published on the web, or the mail server confirmed it.
- **pattern**: built from a pattern we saw a real address use at that domain.
- **guessed**: a common pattern with nothing confirming it. Don't send these
  without checking.

Tell your assistant to prefer `tier: safe` for anything it will email.
