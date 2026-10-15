# Moving from Apollo

OpenLeads works the way Apollo does — people and companies with filters, lists,
stages, sequences, tasks and deals — so most of what you have moves straight
across. Everything lands in a SQLite file on your machine.

## 1. Export from Apollo

In Apollo, open **People** (or a saved list), select everyone, and **Export** to
CSV. Do the same for any other lists you want to keep as separate lists.

## 2. Import

```bash
openleads import apollo-contacts.csv --preview          # check the column mapping
openleads import apollo-contacts.csv --list "From Apollo" --tags apollo
```

or **Import & enrich → Import CSV** in the dashboard. Apollo's columns are
recognized automatically — `First Name`, `Last Name`, `Title`,
`Company Name for Emails`, `Email`, `Person Linkedin Url`, `City`, `State`,
`Country`, `# Employees`, `Industry`, the phone columns, `Website` and the stage —
and you can re-map any column before importing. Contacts already in OpenLeads are
matched by email and **updated without blanking anything**.

Import each Apollo list with its own `--list` name to keep the grouping.

### Stages

| Apollo stage | OpenLeads stage |
|---|---|
| Cold | New |
| Approaching | Approaching |
| Replied | Replied |
| Interested | Interested |
| Not Interested | Not interested |
| Unresponsive | Unresponsive |
| Do Not Contact | Do not contact |
| Bad Data | Bad data |

Anything else (e.g. *Changed Job*) comes in as **New**; set it by hand or with
`openleads people stage EMAIL --to …`.

## 3. Check the emails

Apollo's email status doesn't carry over as proof. Run the addresses through
OpenLeads' own checks, which label each one **found**, **pattern** or **guessed**
and decide **safe** or **risky**:

**Import & enrich → Enrich a list**, or `openleads enrich apollo-contacts.csv`.
Rows that had no email but a name and company can be found the same way
(`openleads import … --missing-out missing.csv`, then `openleads enrich missing.csv`).

## 4. Rebuild your sequences

Sequences don't export from Apollo, but the shape is the same. Create one from the
5-step starter and paste your copy in:

```bash
openleads seq create "Q4 outbound" --pitch "One line about what you offer"
```

Then edit the steps in **Sequences** — automatic emails, manual emails, calls,
LinkedIn tasks and action items, with delays, A/B variants and same-thread
follow-ups. Apollo's `{{first_name}}` and `{{company}}` variables work as-is;
OpenLeads also accepts fallbacks (`{{first_name|there}}`) and spintax
(`{Hi|Hey}`). Reusable emails go in **Templates**. See the
[sequences guide](./sequences.md).

## 5. Describe your ICP

Apollo's scoring doesn't move over either. Set yours in **Settings → ICP scoring**
— seniority, department, industry, company size, technologies, title keywords and
location — and preview how your contacts grade before saving. Every contact then
gets a 0–100 fit score and an A–D grade you can filter and sort by.

## 6. Connect your mailbox

`openleads config` (or **Settings → Mailbox**) with an app password, then
`openleads doctor` to check SPF, DKIM and DMARC. Turn on IMAP so replies and
bounces stop sequences automatically. Sending stays inside your warmup ramp and
daily cap, and everything is a dry run until you say otherwise. See
[sending](./sending.md) and [deliverability](./deliverability.md).

## Going back the other way

Any list or filter exports in Apollo's own import format:

```bash
openleads lists export "Q4 dentists" -f apollo -o q4.csv
```

or **Export → Apollo CSV** from People. HubSpot format works the same way
(`-f hubspot`).
