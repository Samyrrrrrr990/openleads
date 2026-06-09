# Responsible use

OpenLeads is a powerful, free tool. With that comes responsibility. Read this before
running campaigns.

## What OpenLeads is for

- Legitimate **B2B outreach** (sales, partnerships, sponsorships)
- **Recruiting** and talent sourcing
- **Research** on startup ecosystems
- Building **your own** CRM/prospecting workflows

## What it is **not** for

- Spam, bulk unsolicited blasting, or buying/selling scraped lists
- Harassment, scams, phishing, or any deceptive messaging
- Scraping behind logins or violating a site's Terms of Service
- Circumventing rate limits or hammering mail servers

## Know the law

Cold email is legal in many places **if you follow the rules**. You are responsible for
compliance, which may include:

- **CAN-SPAM (US):** truthful headers/subject, a valid physical address, a working
  unsubscribe, and honoring opt-outs promptly.
- **GDPR / ePrivacy (EU/UK):** have a lawful basis (often "legitimate interest" for B2B),
  honor objections, and disclose how you got the contact.
- **CASL (Canada):** stricter consent rules — understand them before emailing Canadians.

This is not legal advice. When in doubt, consult a professional.

## Be a good citizen of the network

- Keep the built-in **rate limits and delays**. They protect mail servers and your
  sending reputation.
- Verification probes never send mail, but they still touch other people's
  infrastructure — don't run them at abusive volume.
- Use a **dedicated sending domain/mailbox**, warm it up, and watch your bounce rate.
  High bounces hurt deliverability for everyone on your domain.
- Send **relevant, personalized, low-volume** outreach. It performs better anyway.

## Sensitive verticals (read this)

v2.0 can reach beyond startup founders into verticals that carry extra ethical and
legal weight. The data is public, but **public ≠ fair game for any use**.

- **Healthcare providers (NPI):** The NPI Registry is public U.S. government data and
  contains *practice* information, not personal/patient data — HIPAA does not apply to it.
  But cold-emailing clinicians is heavily regulated and easily resented. The `npi` source
  deliberately returns rich records **without fabricating emails** (NPI rarely exposes one).
  Use it for legitimate research, directory building, or genuinely relevant B2B outreach —
  never for medical spam, lead-list resale, or anything touching patients.
- **Researchers / academics (OpenAlex, ORCID):** Scholarly metadata is open by design for
  *scholarly* purposes. Respect that intent — relevant collaboration, recruiting, or
  conference outreach is fine; bulk marketing blasts are not.
- **Developers (GitHub):** A public profile email is published for project contact, not
  for cold sales sequences. Be relevant and low-volume.

When a vertical feels sensitive, it is. Default to less volume, more relevance, and an
easy opt-out — or don't send at all.

## Data hygiene

- Never commit scraped emails or `leads.csv` to a public repo (the `.gitignore` already
  blocks this).
- Delete data you no longer need.
- Honor any opt-out or deletion request immediately.

Used well, OpenLeads helps small teams and nonprofits compete with expensive tools.
Please keep it that way.
