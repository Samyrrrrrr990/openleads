# The local web dashboard

```bash
openleads web                 # → http://127.0.0.1:8787
openleads web --port 9000     # custom port
openleads web --no-open       # don't auto-open a browser
openleads web --classic       # the pre-5.5 dashboard as the home page
openleads demo                # the same dashboard on an invented demo workspace
```

A full sales workspace in your browser, running on the same engine and the same
local database as the terminal: your morning, an ask box, people and companies,
sequences and approvals, workflows, deals and tasks.

## The app

The page opens on **Today**: who replied, which emails are waiting for your yes,
what's due, and the people found since you last looked. With a model connected,
one or two sentences on top say what matters first.

At the bottom is the ask box. Type what you want, the way you would in a terminal:

```text
email 15 agencies in Miami about our SEO audit
every weekday at 9am find 20 dentists in Austin and email them about reminders
who replied this week and what do they want?
```

OpenLeads answers a question straight away. Anything else comes back as a
numbered plan, with who read it (the built-in rules or your model), and nothing
happens until you press **Run it**. A search runs and streams what it finds. Emails
are written and put in the approval queue; the dashboard never sends on its own. A
schedule is saved as a workflow. If a model read more into your sentence than the
rules did, the button says **Yes, run it** and tells you why.

Six sections, in the sidebar and under `g` then a letter:

| Section | Key | What's in it |
|---|---|---|
| **Today** | `g t` | The briefing and the ask box |
| **People** | `g p` | People, companies, lists, find people, import and enrich, data health |
| **Outreach** | `g o` | Approvals, sequences, templates, compose and send |
| **Workflows** | `g w` | Saved plans, on a schedule or a trigger, and the node editor |
| **Pipeline** | `g d` | Deals, tasks, activity, analytics |
| **Settings** | `g s` | AI model, doctor, every setting |

`⌘K` (or `Ctrl K`) opens the command palette: jump to a page, find a person by
name, or type a whole request and send it to the ask box. `/` focuses the ask box
and `t` switches light and dark.

Some screens (the workflow editor, compose, find people, import, data health,
analytics and the full settings form) are the classic dashboard's, shown inside
the app. They work the same and use the same data. The whole classic dashboard
stays at `/classic/`, and `openleads web --classic` makes it the home page.

The app's shell and interface pieces are forked from
[T3 Code](https://github.com/pingdotgg/t3code) (MIT). See
[THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md).

---

## Local-first, by construction

- **stdlib only.** The server is a `ThreadingHTTPServer` from Python's standard
  library (`openleads/web/server.py`). No Flask, no Node, no build step.
- **Bound to localhost.** It listens on `127.0.0.1`, not reachable from your
  network.
- **Pre-built UI.** The app is built from `app/` when a release is cut and shipped
  inside the wheel; the classic dashboard is plain ES modules and CSS under
  `openleads/web/static/`. End users need **no toolchain**. From a git checkout,
  `npm ci && npm run build` in `app/` builds the app; without it you get the
  classic dashboard.
- **No external requests from the page.** A strict same-origin
  Content-Security-Policy blocks third-party scripts, styles and fonts. The
  typeface ships inside the package, and there is no CDN and no analytics:
  nothing phones home.

## The classic dashboard's pages

| Group | Page | What |
|---|---|---|
| Workspace | **Home** | KPIs with trends (contacts, sends, reply rate, pipeline), a sends chart, the stage funnel, today's tasks, active sequences, recent activity and a setup checklist |
| | **Find people** | Plain-English search across every free source; results stream in, already scored and saved |
| | **People** | The contact database: filter sidebar with live counts, saved searches, configurable columns, bulk actions on a selection or every matching row, and a full contact record |
| | **Companies** | Accounts with tech stack, size, industry and stage; profile any company from its website |
| | **Lists** | People and company lists as cards; open, enroll, export |
| Engage | **Sequences** | Step timeline editor with A/B variants, live preview, contacts and Run now ([guide](./sequences.md)) |
| | **Tasks** | Overdue / Today / Upcoming queue and a one-at-a-time focus mode |
| | **Templates** | Reusable emails with variables, spintax and a live preview |
| | **Compose & send** | One-off drafts for a set of people, edited inline, dry-run or live |
| Pipeline | **Deals** | Drag-and-drop board with weighted forecast and deal records |
| | **Analytics** | Sending, replies and conversion over time |
| | **Activity** | The workspace-wide feed, grouped by day, filterable |
| Automate | **Workflows** | Recipes drawn as a node canvas ([guide](./workflows.md)) |
| | **Recipes & watchers** | Scheduled searches, alerts and run history |
| | **Import & enrich** | Import a CSV with column mapping; find and verify emails for a list |
| Settings | **Settings** | Sender, mailbox, sending policy, AI, integrations, **ICP scoring**, and **Data & backup** |
| | **Data health** | What to fix before sending, and duplicate merge |
| | **Doctor** | The `openleads doctor` checks |

The [workspace guide](./workspace.md) covers what each of these does with your data.

### Records and deep links

Every record has its own URL, so you can bookmark or share a view on your own
machine: `#/people/jane@acme.com`, `#/companies/acme.com`, `#/sequences/3`,
`#/deals/7`, `#/templates/2`. Filters live in the URL too:
`#/people?stage=interested&tier=safe`, `#/activity?show=replies`.

### Command palette and shortcuts

Press **⌘K** (Ctrl+K) or **/** anywhere to search people and companies, jump to
a page, or run an action (new task, deal, sequence, template or list; import a
CSV; start the task queue; find new people for what you typed).

| Keys | Does |
|---|---|
| ⌘K · / | Command palette |
| G then H, F, P, C, L, S, T, M, D, A, V, W, I | Go to Home, Find, People, Companies, Lists, Sequences, Tasks, Templates, Deals, Analytics, Activity, Workflows, Import |
| N | The page's New button |
| T | Toggle dark mode |
| ? | List every shortcut |
| Enter · S · Z | In the task queue: complete, skip, snooze |
| [ · ] | On a focused deal card: move it a stage back or forward |

Shortcuts never fire while you're typing or inside a dialog.

### Reading an email address

Every address carries one small mark. Its **shape** says how OpenLeads knows the
address, and its **color** says whether it will deliver:

| Mark | Meaning |
|---|---|
| filled square | **Found**: published on the web or confirmed by the mail server |
| half-filled square | **Pattern**: built from an address format seen at that company |
| outlined square | **Guessed**: a common format with nothing confirming it |
| green, amber, red | Deliverable, risky, will bounce |

Hover a mark for the full reason; the contact record lists every check. The
same marks appear in tables, records, search results and exports.

### Light and dark

The interface follows your system theme; the moon/sun button (or **T**) pins one.
Text uses your system font. Email addresses in the people table and on contact
cards use Atkinson Hyperlegible, a typeface drawn so that `l`, `I` and `1` can't be
mistaken for each other. Dark mode is near
black with hairline borders. It respects `prefers-reduced-motion` and works down to
phone width.

## The JSON API

The server exposes a JSON API that the UI uses and you can script against.
Long-running actions stream **newline-delimited JSON** so progress renders live.

| Area | Endpoints |
|---|---|
| Engine | `GET /api/state` · `GET /api/sources` · `POST /api/find` (stream) · `/api/verify` · `/api/write` · `/api/send` (stream) · `/api/run` (stream) · `/api/enrich` (stream) |
| Workspace | `GET /api/meta` · `/api/home` · `/api/health` · `/api/activity` |
| People | `POST /api/people/search` · `/facets` · `/create` · `/update` · `/tags` · `/bulk` · `/export` · `GET /api/people/get` |
| Companies | `POST /api/companies/search` · `/create` · `/update` · `/bulk` · `/profile` · `/enrich` (stream) · `GET /api/companies/get` |
| Lists, tags, notes | `GET /api/lists` · `POST /api/lists/save` · `/add` · `/remove` · `/delete` · `GET /api/tags` · `POST /api/notes/add` · … |
| Sequences | `GET /api/sequences` · `/get` · `POST /api/sequences/save` · `/status` · `/enroll` · `/unenroll` · `/pause` · `/preview` · `/run` (stream) |
| Tasks, deals | `GET /api/tasks` · `POST /api/tasks/save` · `/complete` · `/skip` · `/reopen` · `GET /api/deals` · `POST /api/deals/save` · `/move` |
| Templates | `GET /api/templates` · `POST /api/templates/save` · `/preview` · `/delete` |
| Data | `POST /api/import/preview` · `/api/import` · `GET /api/duplicates` · `POST /api/duplicates/merge` · `GET /api/scoring` · `POST /api/scoring/save` · `/preview` · `/explain` |
| Settings | `GET/POST /api/settings` · `GET /api/doctor` · `GET /api/ai` · `POST /api/ai/use` · `/api/ai/test` |
| Today and asking | `GET /api/today` · `/api/today/line` · `/api/drafts/waiting` · `POST /api/drafts/approve` · `/skip` · `/api/replies/done` · `/api/today/snooze` · `/api/ask/plan` · `/api/ask/run` (stream) |

Errors come back as JSON with an `error` message and a 4xx status;
the server never sends a traceback to the client.

Stream events look like:

```json
{"type":"phase","message":"searching yc…"}
{"type":"lead","lead":{"email":"ada@acme.ai","tier":"safe","score":96, ...}}
{"type":"done","count":41,"safe":41,"risky":9,"leads":[...]}
```

## Security

The dashboard can send email from your mailbox, so it treats every other website
open in your browser as hostile:

- **Localhost only.** It binds `127.0.0.1` and refuses any request whose `Host`
  header isn't a loopback name, which stops DNS-rebinding attacks. Add names with
  `OPENLEADS_ALLOWED_HOSTS=myhost.lan` if you put it behind your own proxy.
- **No cross-site requests.** Requests marked cross-site by the browser
  (`Sec-Fetch-Site`), or carrying an `Origin` other than the dashboard's own
  (including `Origin: null` from sandboxed frames and `file://` pages), get `403`.
- **JSON only.** Every write must be `Content-Type: application/json` (`415`
  otherwise), which a plain HTML form on another site can't send. Bodies over 25 MB
  get `413`; malformed JSON gets `400`.
- **Can't be framed by another site.** `X-Frame-Options: DENY` and
  `frame-ancestors 'none'` on everything, with one exception: the classic dashboard
  under `/classic/` allows this same origin (`SAMEORIGIN`, `frame-ancestors 'self'`)
  so the app can show its screens.
- **A plan runs once, and never live.** `POST /api/ask/run` takes the id of a plan
  `/api/ask/plan` showed you, runs it a single time and queues any email for
  approval. A plan a model widened needs `confirmed: true`.
- **Strict headers.** Same-origin CSP with no inline scripts, `nosniff`,
  `Referrer-Policy: no-referrer`, same-origin opener and resource policies.
- **Secrets stay put.** Stored `chmod 600` on disk, shown masked in the UI, never
  sent back to the browser in full. Static files are path-traversal guarded.

If you want it beyond localhost (e.g. a home server), put it behind your own
authenticated reverse proxy and allow its host name. OpenLeads deliberately ships
no login because it's built to run on the machine you're sitting at.
