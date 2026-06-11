# The local web dashboard

```bash
openleads web                 # → http://127.0.0.1:8787
openleads web --port 9000     # custom port
openleads web --no-open       # don't auto-open a browser
```

A full UI for the four clicks — **find, write, connect, send** — plus Leads, CRM,
Settings, and Doctor. It's the same engine the CLI uses, in your browser.

---

## Local-first, by construction

- **stdlib only.** The server is a `ThreadingHTTPServer` from Python's standard
  library (`openleads/web/server.py`). No Flask, no Node, no build step.
- **Bound to localhost.** It listens on `127.0.0.1` — not reachable from your
  network.
- **Pre-built UI.** The single-page app is committed as plain static files in
  `openleads/web/static/` (`index.html`, `styles.css`, `app.js`). End users need
  **no toolchain** — it ships in the wheel.
- **No external requests from the page.** A strict same-origin Content-Security-Policy
  blocks third-party scripts, styles, and fonts. The UI uses your system fonts; no
  CDN, no analytics, nothing phones home. The privacy promise holds end-to-end.

## The pages

| Page | What |
|---|---|
| **Find** (1) | A command bar — type plain English, pick a source, set count, toggle deliverable-only / deep. Results **stream in live** into an engine console and a tiered table. |
| **Write** (2) | Generate personalized, spam-linted drafts for your `safe` leads. Edit subject/body inline — your edits are what gets sent. |
| **Connect** (3) | Settings & mailbox setup. Provider presets, app password, sender identity, AI key, sending policy. Secrets are masked and never round-trip to the browser in full. |
| **Send** (4) | Warmup status, deliverability grade, dry-run/live toggle, and a **live send feed**. |
| **Leads** | Everything found this session; filter by tier; "why safe" reasons. |
| **CRM** | Local SQLite CRM: totals, sent counts, suppression, and a status table. |
| **Doctor** | The `openleads doctor` checks, rendered as status dots. |

## The JSON API

The server exposes a small JSON API (`openleads/web/api.py`) that bridges to the same
engine functions the CLI calls. Long-running actions stream **newline-delimited JSON**
so the browser can render progress live.

| Endpoint | Method | Notes |
|---|---|---|
| `/api/state` | GET | bootstrap: version, sources, settings, CRM snapshot |
| `/api/sources` | GET | available sources |
| `/api/find` | POST | **stream** — `phase` / `lead` / `done` events |
| `/api/verify` | POST | verify concrete addresses |
| `/api/write` | POST | draft emails for given leads |
| `/api/send` | POST | **stream** — dry-run or live; `send` / `done` events |
| `/api/run` | POST | **stream** — the full find→write→send pipeline |
| `/api/crm` | GET/POST | CRM overview + rows |
| `/api/settings` | GET/POST | read / update settings (secret-aware) |
| `/api/doctor` | GET | structured health report |

Stream events look like:

```json
{"type":"phase","message":"searching yc…"}
{"type":"lead","lead":{"email":"ada@acme.ai","tier":"safe","score":96, ...}}
{"type":"done","count":41,"safe":41,"risky":9,"leads":[...]}
```

## Design notes

The interface is intentionally **black and white with hints of red** — a precision
instrument, not a toy. It respects `prefers-reduced-motion`, uses your OS fonts for
instant, offline, private rendering, and supports hash deep-links
(`/#crm`, `/#settings`, …) so you can bookmark a view.

## Security

- localhost-only bind; same-origin CSP; `X-Content-Type-Options: nosniff`.
- No inline scripts; static assets are path-traversal-guarded.
- Secrets are stored `chmod 600` on disk and shown masked in the UI.
- The server never leaks a traceback to the client — every endpoint returns
  structured JSON errors.

If you want to expose it beyond localhost (e.g. a home server), put it behind your own
authenticated reverse proxy — OpenLeads deliberately ships no auth because it's built
to run on the machine you're sitting at.
