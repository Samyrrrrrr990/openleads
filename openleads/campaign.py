"""
Cold-email companion (optional). Turns a leads file into personalized outreach.

This is the *only* part of OpenLeads that touches paid-optional services and your
mailbox — it's opt-in and dry-run by default. The core lead engine never sends
anything.

Install with the extra:  ``pip install 'openleads[campaign]'``
Configure via environment (see ``.env.example``):

    OPENROUTER_API_KEY   free/cheap LLM for drafting
    SMTP_USER, SMTP_PASS your mailbox
    SMTP_HOST, SMTP_PORT default mail.example.com:465 (SSL)
    SENDER_NAME          your name in the From header
    CAMPAIGN_ORG         who you represent
    CAMPAIGN_CONTEXT     a few lines pitching what you're reaching out about

Run:  ``openleads campaign``  (dry run)  ·  ``openleads campaign --live``  (send)
"""
from __future__ import annotations

import csv
import os
import re
import smtplib
import time
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formatdate, make_msgid

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

# --- pure text helpers (unit-tested, no I/O) ------------------------------- #
PLACEHOLDER_RE = re.compile(r"[\[\{][^\]\}]{0,50}[\]\}]")  # [anything] or {anything}


def clean_dashes(text: str) -> str:
    """Normalize exotic Unicode punctuation/spaces to plain ASCII (outreach style)."""
    repl = {
        "—": ",", "–": ",",
        "‑": "-", "‐": "-", "−": "-",
        "’": "'", "‘": "'",
        "“": '"', "”": '"',
        "…": "...",
    }
    for k, v in repl.items():
        text = text.replace(k, v)
    text = re.sub(r"[  -   　]", " ", text)
    text = re.sub(r"[​‌‍﻿]", "", text)
    return text


def has_placeholder(text: str) -> bool:
    return bool(PLACEHOLDER_RE.search(text))


def strip_placeholders(text: str) -> str:
    return re.sub(r"\s*" + PLACEHOLDER_RE.pattern, "", text).strip()


def format_body(body: str, first_name: str) -> str:
    """Guarantee a greeting line and blank lines between paragraphs."""
    body = (body or "").strip()
    body = re.sub(r"\n[ \t]+", "\n", body)
    body = re.sub(r"\n{3,}", "\n\n", body)
    lines = body.split("\n")
    first_line = lines[0].strip().lower() if lines else ""
    if any(first_line.startswith(w) for w in ("hi", "hey", "hello", "dear")):
        if len(lines) > 1 and lines[1].strip() != "":
            lines.insert(1, "")
            body = "\n".join(lines)
    else:
        name = (first_name or "").strip() or "there"
        body = f"Hey {name},\n\n{body}"
    return re.sub(r"\n{3,}", "\n\n", body).strip()


def parse_response(response: str, company: str) -> tuple[str, str]:
    if "SUBJECT:" in response and "EMAIL:" in response:
        parts = response.split("EMAIL:", 1)
        subject = parts[0].replace("SUBJECT:", "").strip().split("\n")[0].strip()
        body = parts[1].strip()
    else:
        subject = f"Quick note for {company}".strip()
        body = response.strip()
    return subject, body


# --- config (lazy: read only when actually running) ------------------------ #
def _load_env():
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except Exception:
        pass


def _config() -> dict:
    _load_env()
    return {
        "api_key": os.environ.get("OPENROUTER_API_KEY", ""),
        "model": os.environ.get("OPENROUTER_MODEL", "openai/gpt-oss-120b:free"),
        "smtp_user": os.environ.get("SMTP_USER") or os.environ.get("PRIVATEMAIL_USER", ""),
        "smtp_pass": os.environ.get("SMTP_PASS") or os.environ.get("PRIVATEMAIL_PASS", ""),
        "smtp_host": os.environ.get("SMTP_HOST", "mail.example.com"),
        "smtp_port": int(os.environ.get("SMTP_PORT", "465")),
        "sender": os.environ.get("SENDER_NAME", "Me"),
        "org": os.environ.get("CAMPAIGN_ORG", "our team"),
        "context": os.environ.get("CAMPAIGN_CONTEXT",
                                  "We're reaching out about a potential collaboration."),
        "max_leads": int(os.environ.get("CAMPAIGN_MAX", "60")),
    }


def build_prompt(lead: dict, cfg: dict) -> str:
    first = lead.get("first_name") or "there"
    company = lead.get("company", "")
    loc = f"{lead.get('city','')}, {lead.get('country','')}".strip(", ")
    li = lead.get("linkedin_url") or "not available"
    return f"""Act like a world-class cold emailer with 20+ years of experience, writing on behalf of {cfg['org']}.

LEAD (use these REAL values; never write a placeholder):
- First name: {first}
- Full name: {lead.get('first_name','')} {lead.get('last_name','')}
- Title: {lead.get('title','')}
- Company: {company}
- Industry: {lead.get('industry','')}
- Location: {loc}
- LinkedIn: {li}

ABOUT {cfg['org']}:
{cfg['context']}

OUTPUT ONLY this exact format:

SUBJECT: <one short subject line>

EMAIL:
Hey {first},

<paragraph one>

<paragraph two>

Best,
{cfg['sender']}

RULES:
- Write the ACTUAL name "{first}" and company "{company}". NEVER output [brackets] or {{braces}} placeholders. If unsure of a detail, leave it out.
- Blank line between greeting, each paragraph, and the signature.
- Under 120 words, punchy, human, specific. No em dashes (use commas)."""


def get_leads(csv_path: str, max_leads: int) -> list[dict]:
    if not os.path.exists(csv_path):
        raise SystemExit(f"[error] {csv_path} not found. Run `openleads find` first.")
    leads = []
    with open(csv_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            email = (row.get("Email") or "").strip()
            if not email:
                continue
            leads.append({
                "first_name": (row.get("First Name") or "").strip(),
                "last_name": (row.get("Last Name") or "").strip(),
                "email": email,
                "title": (row.get("Title") or "").strip(),
                "company": (row.get("Organization Name") or row.get("Company") or "").strip(),
                "industry": (row.get("Industry") or "").strip(),
                "city": (row.get("City") or "").strip(),
                "country": (row.get("Country") or "").strip(),
                "linkedin_url": (row.get("LinkedIn Url") or "").strip(),
            })
    return leads[:max_leads]


def call_llm(prompt: str, cfg: dict, max_tokens: int = 700) -> str:
    import requests
    headers = {"Authorization": f"Bearer {cfg['api_key']}", "Content-Type": "application/json"}
    body = {"model": cfg["model"], "max_tokens": max_tokens, "temperature": 0.85,
            "messages": [{"role": "user", "content": prompt}]}
    for attempt in range(5):
        res = requests.post(OPENROUTER_URL, headers=headers, json=body, timeout=60)
        if res.status_code == 429:
            time.sleep(15 * (attempt + 1))
            continue
        res.raise_for_status()
        break
    else:
        raise RuntimeError("rate limited after 5 retries")
    raw = res.json()["choices"][0]["message"]["content"].strip()
    raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
    return raw


def generate(lead: dict, cfg: dict) -> dict:
    prompt = build_prompt(lead, cfg)
    result = {"subject": "", "body": ""}
    for attempt in range(3):
        response = call_llm(prompt, cfg)
        subject, body = parse_response(response, lead.get("company", ""))
        subject = clean_dashes(subject)
        body = format_body(clean_dashes(body), lead.get("first_name", ""))
        result = {"subject": subject, "body": body}
        if not has_placeholder(subject) and not has_placeholder(body):
            return result
    result["subject"] = strip_placeholders(result["subject"]) or f"Note for {lead.get('company','')}"
    result["body"] = format_body(strip_placeholders(result["body"]), lead.get("first_name", ""))
    return result


def send_email(lead_email: str, subject: str, body: str, cfg: dict) -> None:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{cfg['sender']} <{cfg['smtp_user']}>"
    msg["To"] = lead_email
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain=cfg["smtp_user"].split("@")[-1] or "localhost")
    msg.attach(MIMEText(body, "plain"))
    with smtplib.SMTP_SSL(cfg["smtp_host"], cfg["smtp_port"]) as server:
        server.login(cfg["smtp_user"], cfg["smtp_pass"])
        server.sendmail(cfg["smtp_user"], lead_email, msg.as_string())


def run_campaign(dry_run: bool = True, leads_path: str = "leads.csv") -> int:
    cfg = _config()
    if not cfg["api_key"]:
        raise SystemExit("[error] set OPENROUTER_API_KEY (see .env.example).")
    leads = get_leads(leads_path, cfg["max_leads"])
    print("=" * 60)
    print(f"  OpenLeads campaign · model: {cfg['model']}")
    print(f"  mode: {'DRY RUN (no send)' if dry_run else 'LIVE SEND'} · leads: {len(leads)}")
    print("=" * 60 + "\n")

    results = []
    for i, lead in enumerate(leads, 1):
        print(f"[{i}/{len(leads)}] {lead['first_name']} {lead['last_name']} "
              f"| {lead['title']} @ {lead['company']} <{lead['email']}>")
        try:
            gen = generate(lead, cfg)
            print(f"   subject: {gen['subject']}\n   ---\n{gen['body']}\n")
            status = "preview"
            if not dry_run:
                send_email(lead["email"], gen["subject"], gen["body"], cfg)
                status = "sent"
                print("   sent!\n")
            results.append({**lead, **gen, "status": status,
                            "timestamp": datetime.now().isoformat()})
        except Exception as e:
            print(f"   error: {e}\n")
            results.append({**lead, "subject": "", "body": "",
                            "status": f"error: {e}", "timestamp": datetime.now().isoformat()})
        if i < len(leads):
            time.sleep(4)

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out = f"campaign_{ts}.csv"
    fields = ["first_name", "last_name", "email", "title", "company",
              "subject", "body", "status", "timestamp"]
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in results:
            w.writerow({k: r.get(k, "") for k in fields})
    print(f"[log] {out} · {sum(1 for r in results if r['status'] in ('sent', 'preview'))} processed")
    return 0


def main(argv=None) -> int:
    import argparse
    argv = argv if argv is not None else []
    p = argparse.ArgumentParser(prog="openleads campaign",
                                description="Personalized cold-email companion (opt-in).")
    p.add_argument("--live", "--send", action="store_true", dest="live",
                   help="actually send (default is a dry-run preview)")
    p.add_argument("--leads", default="leads.csv", help="leads CSV path")
    args = p.parse_args([a for a in argv if a])
    return run_campaign(dry_run=not args.live, leads_path=args.leads)


if __name__ == "__main__":
    raise SystemExit(main(__import__("sys").argv[1:]))
