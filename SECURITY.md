# Security Policy

## Reporting a vulnerability

If you find a security issue, please **do not open a public issue**. Email
**info@joinresearch.ca** with details and steps to reproduce. We aim to respond within
72 hours and will credit you (if you wish) once a fix ships.

## Scope & sensible expectations

OpenLeads is a local CLI tool. The most relevant security concerns are:

- **Credential handling** — SMTP and API keys live only in your local `.env`, which is
  git-ignored. They are read at runtime and never transmitted anywhere except the
  service they belong to (your mail server / OpenRouter). Never commit `.env`.
- **Outbound SMTP** — verification opens connections on port 25 but never sends mail.
- **No telemetry** — OpenLeads phones home to nobody.

## Handling secrets

- `.env` is in `.gitignore`. Keep it that way.
- If you accidentally commit a secret, **rotate it immediately** and scrub history
  (e.g. `git filter-repo`).
- Use a dedicated mailbox / API key for automation, not your personal one.

## Supported versions

The latest `main` is supported. This is an early-stage project; pin a commit if you
need stability.
