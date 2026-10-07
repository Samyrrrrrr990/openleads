# openleads (npm wrapper)

Run **[OpenLeads](https://github.com/Samyrrrrrr990/openleads)** with `npx`. It finds
people and their work emails from free public data (no API keys), labels every
address as found, pattern or guessed, and can send on a schedule.

```bash
npx openleads find "dentists in Austin"       # one-off, nothing to install
npm i -g openleads && openleads                # or install the command
```

OpenLeads is a Python tool. On first run this wrapper creates a private virtualenv
in `~/.openleads/npm-venv` and installs the matching `openleads` version from PyPI
into it. Your system Python isn't touched, and it works on Homebrew and
Debian/Ubuntu Pythons that refuse `pip install`. You need **Python 3.8+**.

Use it as an MCP server for Claude, Cursor and others:

```json
{ "mcpServers": { "openleads": { "command": "npx", "args": ["-y", "openleads", "mcp"] } } }
```

Environment: `OPENLEADS_PYTHON` picks the Python to use, and `OPENLEADS_HOME` moves
the private environment.

License: AGPL-3.0-or-later, with a commercial license available. See the
[main project](https://github.com/Samyrrrrrr990/openleads).
