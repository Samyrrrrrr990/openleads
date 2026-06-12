# Automation & the assistant

OpenLeads v3.5 can run your outreach for you: describe a campaign in one line, and
let your own machine find, draft, and send it at the right time — with every message
landing in your **Sent** folder like you typed it yourself.

## The assistant (natural language → a configured campaign)

Tell OpenLeads what you want in plain English:

```bash
openleads assistant "send 50 emails to fintech founders for my SaaS at 9am"
```

It parses the **audience** ("fintech founders"), the **count** (50), what you're
**pitching** ("my SaaS"), and the **send time** (9am), then finds the leads, drafts a
personalized email for each, and previews everything as a dry run. Nothing is sent
until you say so.

You can do the same conversationally inside `openleads chat` — just type the request.
When you ask to *send* or *schedule*, it routes to the assistant; when you ask to
*find*, it searches.

It works **fully offline** with a rule-based interpreter (no key required). If you set
`OPENROUTER_API_KEY` (a free model is fine), messier phrasing is understood by the LLM,
which fills the same validated action schema.

### What "reach" means for a campaign

A campaign drafts every `safe` (deliverable) lead **plus** high-confidence `risky`
ones — those scoring **≥ 55%** on the calibrated likelihood. On the common case where
outbound port 25 is blocked, a healthy authenticated corporate domain with a common
pattern scores ~62%, so you still get a real, sendable batch instead of an empty list.
Catch-all guesses are deliberately kept below that line.

## On-device scheduling

Install a daily drip that runs unattended on your own machine:

```bash
openleads schedule --at 09:00      # install (launchd on macOS, crontab on Linux)
openleads schedule status          # is it installed?
openleads schedule off             # remove it
```

Each day at the chosen time, OpenLeads runs any **due scheduled campaigns** and sends
any **sequence follow-ups** that have come due — always within your warmup/daily cap.
Run a cycle by hand anytime with:

```bash
openleads drip            # dry-run preview
openleads drip --live     # actually send
```

### Send-time intelligence

Sends are paced like a human, not blasted: weekdays only, inside business-hour windows
(08:00–11:00 and 13:00–16:00 by default), spaced apart with jitter, capped per day.
Recipient time zones are inferred offline from country/city so your email lands in
*their* morning, wherever they are.

## Emails show up in your Sent folder

Mail sent over raw SMTP normally never appears in your provider's Sent folder (Gmail
and Workspace are the exception — they journal it for you). OpenLeads fixes this for
everyone else by saving each real send to your mailbox's IMAP **Sent** folder.

Control it with the `save_to_sent` setting:

| Value | Behavior |
|-------|----------|
| `auto` *(default)* | Save to Sent for every provider **except** Gmail/Workspace (which already do). |
| `always` | Always save (use if your Gmail setup doesn't journal sends). |
| `never` | Don't touch IMAP. |

```bash
openleads config set save_to_sent always
```

This needs IMAP configured (it falls back to your SMTP credentials). It's best-effort
and fully isolated — a Sent-folder hiccup can never fail an actual send.

## Safety rails (unchanged)

- **Dry-run by default** everywhere — add `--live` to send for real.
- **Suppression-aware**: never emails anyone who bounced, unsubscribed, or was already
  contacted.
- **Warmup-capped**: a fresh mailbox ramps up gradually instead of blasting day one.
- Plain text, a real `List-Unsubscribe` header, and a polite opt-out footer.

See [Deliverability](deliverability.md) for the sender-side reputation checks, and
[Sending](sending.md) for mailbox setup.
