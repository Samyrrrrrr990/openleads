# How the email engine works

The part of OpenLeads people care about most is how it finds and verifies an email for
**free**. Here's the whole thing, no magic.

## 1. From a name + domain to candidates

Given `Ada Lovelace` at `acme.io`, OpenLeads generates the email patterns that
real companies actually use, in rough order of likelihood:

```
first.last@   ada.lovelace@acme.io
firstlast@    adalovelace@acme.io
first@        ada@acme.io
flast@        alovelace@acme.io
first_last@   ada_lovelace@acme.io
f.last@       a.lovelace@acme.io
last@         lovelace@acme.io
```

## 2. Does the domain even accept mail? (MX lookup, cross-checked)

Before bothering a mail server, OpenLeads asks for the domain's MX (mail exchanger)
records over **DNS-over-HTTPS** — and it asks **two independent resolvers**
(Google *and* Cloudflare):

```
GET https://dns.google/resolve?name=acme.io&type=MX
GET https://cloudflare-dns.com/dns-query?name=acme.io&type=MX
-> aspmx.l.example.com, alt1.aspmx.l.example.com, ...
```

Querying two resolvers does two things: it **survives one provider being down**, and it
lets OpenLeads **reward agreement** — when both resolvers return the same mail exchangers,
that's a stronger signal than one. No MX records at all → the domain can't receive email
→ the lead is dropped. This is a free, instant filter that removes dead domains.

## 3. Verifying without sending (SMTP RCPT)

This is the core trick. Email delivery is a short conversation. OpenLeads has the
**beginning** of that conversation and then hangs up before any message is sent:

```
S: 220 aspmx.l.google.com ESMTP
C: HELO openleads.local
S: 250 Hello
C: MAIL FROM:<verify@yourdomain.com>
S: 250 OK
C: RCPT TO:<ada@acme.io>
S: 250 OK                         <-- mailbox exists ✅
C: QUIT
```

A `250`/`251` on `RCPT TO` means the server will accept mail for that address — i.e. the
mailbox exists. A `550` means it doesn't. **No `DATA` command is ever sent, so no email
is delivered.** This is exactly what paid verifiers do; it's just SMTP.

## 4. Catch-all detection (honesty)

Some domains accept **every** address (`anything@domain.com` returns `250`), which makes
per-mailbox verification meaningless. OpenLeads detects this by first probing a random,
impossible address:

```
C: RCPT TO:<qk7zx9plmn4w@acme.io>
S: 250 OK                         <-- accepts garbage = catch-all
```

If the random probe is accepted, the domain is flagged catch-all and the best-pattern
guess is labeled `catch_all_guess` instead of `verified`. Honesty over vanity numbers.

## Confidence levels + a 0–100 score

Every result keeps a human label **and** an explainable numeric score, so you can sort and
threshold programmatically.

| Label | Meaning |
| --- | --- |
| `verified` | A specific mailbox returned `250` and the domain is **not** catch-all. High confidence. |
| `catch_all_guess` | Domain accepts everything; we return the most likely pattern but can't prove it. |
| `pattern_guess` | Domain has MX but SMTP verification wasn't possible (e.g. port 25 blocked, greylisting). Best-effort. |
| `none` | No MX (unusable domain), or a domain-less public record (e.g. an NPI doctor with no email). |

The **score (0–100)** is built from independent signals, each adding or subtracting:

| Signal | Effect |
| --- | --- |
| MX exists | required (else score 0 / `none`) |
| Both DoH resolvers returned MX | small boost |
| Resolvers **agree** on the mail exchangers | small boost |
| SMTP `250` on a real candidate (not catch-all) | large boost → `verified` |
| Catch-all detected | capped (moderate) |
| Port 25 unreachable | MX-only score |
| Common pattern (`first@` / `first.last@`) | small boost |
| Role account (`info@`, `sales@`) | penalty |
| Disposable domain (`mailinator.com`, …) | disqualified (score 0) |

The exact signals that fired are attached to each lead (visible in JSON/NDJSON output as
`signals`), so a score is never a black box.

## Caching (be fast, be polite)

OpenLeads keeps a small **SQLite cache** at `~/.openleads/cache.db`:

| What | TTL |
| --- | --- |
| MX lookups (per domain) | 7 days |
| SMTP verification (per name+domain) | 14 days |
| Source datasets (e.g. the YC dump) | 1 day |

A cache hit short-circuits the network entirely — re-runs are near-instant and mail servers
aren't probed twice for the same thing. Manage it with `openleads cache info` /
`openleads cache clear`, or bypass it with `--no-cache`.

## Caveats & etiquette

- **Port 25** must be reachable outbound. Many cloud hosts allow it; some residential
  ISPs block it. When blocked, OpenLeads falls back to pattern guesses.
- Big providers (Google Workspace, Microsoft 365) sometimes greylist or accept-all,
  reducing how many you can hard-verify. That's expected.
- OpenLeads paces its probes (small delays, reuses one connection per domain) to be a
  polite network citizen. Please don't remove those delays.
