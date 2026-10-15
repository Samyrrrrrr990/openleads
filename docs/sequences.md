# Sequences

A sequence is multi-step, multi-channel outreach that runs itself — the Apollo
model, on your machine. Each step waits a number of days after the previous one,
then either **sends an email automatically** or **creates a task** for you (a
call, a LinkedIn touch, a hand-written email, any action item). People leave the
sequence the moment they reply, bounce or unsubscribe.

```bash
openleads seq create "Q4 outbound" --pitch "We help clinics fill last-minute cancellations"
openleads seq enroll "Q4 outbound" --list "Q4 dentists"
openleads seq run "Q4 outbound"          # dry run: what would send right now
openleads seq activate "Q4 outbound"     # let the scheduler run it
```

Or in the dashboard: **Sequences → New sequence**.

## Steps

| Step | What happens when it's due |
|---|---|
| **Automatic email** | Rendered for the contact and sent, inside business hours and your warmup cap |
| **Manual email** | A task to write and send it yourself |
| **Phone call** | A call task, with the contact's number one click away |
| **LinkedIn task** | A task with their LinkedIn profile linked |
| **Action item** | Any other to-do |

A manual step **holds the contact in place** until its task is completed or
skipped; then they move on to the next step. New sequences start from a proven
5-step, 11-day cadence — intro email, threaded bump, call, LinkedIn, breakup — that
you can edit, reorder or replace.

### Writing emails

Email steps use [template syntax](#template-syntax), and each can have:

- **A/B variants** — every contact gets one variant (chosen deterministically from
  their email, so a preview matches what is sent), and the sequence page shows
  sends and replies per variant.
- **Same-thread follow-ups** — the step replies to the first email (`re: …`), so a
  bump lands in the existing conversation.
- **AI writing** — leave the variants empty and each email is written from the
  contact's details and the sequence's pitch, by the free LLM if you've configured
  one and the built-in writer otherwise.

The editor's live preview renders any step for a sample or a real contact, with its
spam score and a warning for every variable that would come out blank.

### Template syntax

| Write | Get |
|---|---|
| `{{first_name}}` | the contact's first name |
| `{{first_name\|there}}` | their first name, or "there" if it's blank |
| `{Hi\|Hey\|Hello}` | one of the options, picked per contact |

Variables: `first_name`, `last_name`, `full_name`, `title`, `company`, `domain`,
`website`, `industry`, `city`, `country`, `phone`, `sender_name`, `sender_org`,
`sender_context` (the sequence's pitch, or yours from Settings) and `day`.
Reusable emails live in **Templates**.

## Enrolling people

Add people from a list, a People selection (including "all N matching these
filters"), the CLI, or an AI assistant over MCP. Enrollment skips — and tells you
why — anyone who is:

- suppressed, marked do-not-contact, or bad data;
- not verified **safe** (unless the sequence allows risky emails);
- already in this sequence, or active in another one (unless the sequence allows
  overlap).

## Settings

| Setting | Default | |
|---|---|---|
| Business hours only | on | automatic emails wait for your send window |
| Skip weekends | on | a step due on Saturday or Sunday moves to Monday |
| Daily limit | none | max automatic emails per day from this sequence, on top of your global warmup cap |
| Allow risky emails | off | enroll contacts whose address isn't verified safe |
| One sequence at a time | on | skip people active in another sequence |
| Mark unresponsive | on | finishing with no reply moves the contact to *Unresponsive* |
| Pitch | your Settings pitch | fills `{{sender_context}}` and guides AI steps |

## Running

Active sequences run on the same heartbeat as everything else
(`openleads schedule on`, or `openleads drip` by hand): each tick sends the
automatic emails that are due and creates the due tasks. **Run now** in the
dashboard (or `openleads seq run`) does one pass on demand — as a dry run that
shows exactly what would send, or live. A dry run works on a paused sequence, so
you can check one before you switch it on.

Sends go through the normal sender, so the dry-run default, suppression list,
warmup ramp, daily cap, business-hours window and one-click unsubscribe all apply.
With IMAP connected, replies and bounces are picked up automatically and take the
person out of the sequence.

## Reading the results

The sequence page shows active, contacted, replied (with reply rate) and due-now
counts, how many people wait at each step, sends and completed tasks per step, and
replies per A/B variant. The **Contacts** tab lists everyone by status — active,
paused, finished, replied, bounced, removed — with bulk pause, resume and remove.
