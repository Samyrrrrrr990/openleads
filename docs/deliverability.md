# Deliverability — how OpenLeads decides what's safe to send

The crown jewel of v3. The goal: **only mark an address `safe` when it's genuinely
likely to land**, and do it **without depending on outbound port 25**, which home
ISPs and most clouds block.

This is what separates OpenLeads from free-tier finders that quietly hand you
`first.last@domain` guesses and let your campaign bounce.

---

## The problem with single-probe verification

The classic "email verifier" opens an SMTP connection to the domain's mail server
and issues `RCPT TO:<candidate>` — if the server says `250 OK`, the address exists.

Two things break this:

1. **Port 25 is blocked.** Residential ISPs and providers like AWS/GCP block
   outbound port 25 by default. The probe never connects, so the verifier either
   fails open (marks everything deliverable → bounces) or fails closed (marks
   everything undeliverable → you lose real leads).
2. **Catch-all domains.** Many domains accept *every* address (`250 OK` for
   `asdkfj@domain`), so a single probe tells you nothing.

OpenLeads treats SMTP as **one signal among seven**, not the whole answer.

## The seven signals

All implemented in `openleads/emails/`. Each is best-effort; **any signal error is
treated as absent, never as a false positive** — the engine biases toward *not*
marking something `safe`.

| # | Signal | Module | Port 25? |
|---|---|---|---|
| 1 | **MX consensus** — resolved over **two** DoH resolvers (Google + Cloudflare); they must agree the domain has mail exchangers | `mx.py` | no |
| 2 | **SPF / DMARC presence + policy, MX provider class** — TXT lookups that show the domain is a real, configured mail sender | `mx.py` | no |
| 3 | **Disposable / role / free-provider filtering** — static lists drop `info@`, `noreply@`, throwaway domains, etc. | `patterns.py` | no |
| 4 | **Gravatar existence** — `md5(email)` → `gravatar.com` returns 200 (exists) or 404; a free existence hint with no mail connection | `gravatar.py` | no |
| 5 | **Ground-truth harvesting** — the strongest signal: *real* addresses pulled from GitHub commit authors, `mailto:` links, and `/.well-known/security.txt`. An exact match is `safe` outright | `groundtruth.py` | no |
| 6 | **Learned domain patterns** — once any ground-truth email is seen at a domain, its local-part shape (e.g. `{first}`) is stored and tried first for everyone else there. Compounds across runs | `patterns.py` | no |
| 7 | **SMTP `RCPT` + catch-all double-probe** — when port 25 *is* open, a greylist-aware probe with a two-random-local catch-all test | `smtp_verify.py` | **yes** |

## Scoring → tiers

`score.py` is a **pure function**: `signals → {score: 0–100, tier, confidence, reasons[]}`.
Because it's pure, it's exhaustively unit-tested with no network.

- **`safe`** — emit and send by default. Triggers include:
  - a **ground-truth exact match**; or
  - **SMTP-verified** (non-catch-all); or
  - **learned-pattern match AND Gravatar hit AND healthy MX AND not catch-all**; or
  - **Gravatar hit AND common pattern AND healthy SPF/DMARC**.
- **`risky`** — kept but **not sent by default**. Catch-all domains, pattern-only
  guesses, port-25-blocked-without-corroboration, role-ish addresses.
- **`bad`** — dropped. No MX, disposable, invalid syntax.

`confidence` keeps v2's labels (`verified` / `catch_all_guess` / `pattern_guess` /
`none`) for backward compatibility; `tier` and `reasons[]` are the v3 additions that
drive the UX ("why is this safe?").

```python
from openleads.emails.resolve import find_email, verify_address

res = verify_address("ada@acme.ai")
print(res.tier, res.score, res.reasons)
# safe 96 ['ground-truth match (github commit)', 'MX consensus', 'SPF+DMARC present']
```

## The pattern-learning flywheel

This is why OpenLeads gets **more accurate the more you use it**. Every ground-truth
email teaches the engine that domain's convention; that lesson is stored in
`~/.openleads/openleads.db` (`patterns` table) and applied to every future person at
that domain — promoting an otherwise-unconfirmed guess to `safe` when corroborated.

Free tiers can't do this: their database is the moat, so they have no incentive to
make *your* guesses smarter. OpenLeads' moat is the *engine*, so it does.

## When port 25 is blocked

You lose only signal #7. Signals #1–#6 still run, so you still get plenty of `safe`
leads — they just need corroboration (ground truth, learned pattern + Gravatar, or
healthy auth + common pattern) instead of a live `RCPT`. Run `openleads doctor` to
see whether port 25 is open from your machine.

## Honesty as a feature

OpenLeads would rather under-claim than bounce your domain. A `risky` lead you
*chose* to send beats a `safe` lead that wasn't. That conservatism is the whole point
— deliverability is a reputation game, and one bad batch tanks your inbox placement.

See also: [Sending guide](./sending.md) · [Architecture](./architecture.md).
