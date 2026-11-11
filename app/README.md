# The OpenLeads app

The dashboard `openleads web` opens. React, Vite, TypeScript and Tailwind, built into
`openleads/web/app/` so the Python server can serve it with no Node at runtime.

```bash
cd app
npm ci
npm run dev         # http://localhost:5173, talks to `openleads web --port 8765 --no-open`
npm test            # unit tests (vitest)
npm run typecheck
npm run build       # writes ../openleads/web/app
```

Without a build, `openleads web` serves the classic dashboard, which is always at
`/classic/` too. Releases build the app in CI, so people who install from PyPI never
need Node.

## Layout

| Path | What |
|---|---|
| `src/components/ui/` | Buttons, dialogs, the command palette and other primitives, forked from T3 Code |
| `src/components/shell/` | Sidebar, page header, command palette, toasts, the six sections |
| `src/components/app/` | Small OpenLeads pieces: panels, rows, avatars, the select |
| `src/views/` | One folder per section: `today`, `people`, `outreach`, `pipeline`, `settings` |
| `src/lib/` | The API client, the hash router, formatters and small stores |
| `src/index.css` | Theme tokens (T3 Code's names, OpenLeads' colours) |

Screens the app doesn't have yet (the workflow editor, compose, import, analytics, the
full settings form) open in the classic dashboard. `src/components/shell/sections.ts`
lists them with a `classic` path; give a page its own view and drop that field.

## Where it comes from

The shell, the primitives in `src/components/ui/`, the theme token names and the glass
utilities are forked from [T3 Code](https://github.com/pingdotgg/t3code)'s web app,
which is MIT licensed, Copyright (c) 2026 T3 Tools Inc. The license is in
[`LICENSE-T3CODE`](./LICENSE-T3CODE) and ships with every build as
`LICENSE-T3CODE.txt`. Everything about coding agents, accounts, the desktop shell and
their server was left out; the screens and the data layer are OpenLeads' own.

OpenLeads itself, including this app, is AGPL-3.0-or-later with a commercial license
available. See [`../LICENSE`](../LICENSE) and [`../COMMERCIAL-LICENSE.md`](../COMMERCIAL-LICENSE.md).
