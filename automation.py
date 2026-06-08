"""
NGN Hacks Sponsorship Email Automation
Apollo CSV -> Nemotron 3 Super (OpenRouter) -> PrivateMail SMTP
"""

import smtplib
import imaplib
import requests
import os
import time
import csv
import re
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.utils import formatdate, make_msgid
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

OPENROUTER_API_KEY = os.environ["OPENROUTER_API_KEY"]
PRIVATEMAIL_USER   = os.environ["PRIVATEMAIL_USER"]
PRIVATEMAIL_PASS   = os.environ["PRIVATEMAIL_PASS"]

SMTP_HOST        = "mail.privateemail.com"
SMTP_PORT        = 465
IMAP_HOST        = "mail.privateemail.com"
IMAP_PORT        = 993
SENT_FOLDER      = "Sent"
OPENROUTER_MODEL = "openai/gpt-oss-120b:free"
SENDER_NAME      = "Samyar"
MAX_LEADS        = 60


def get_apollo_leads(csv_path="leads.csv"):
    if not os.path.exists(csv_path):
        print(f"[Error] {csv_path} not found. Export from Apollo and rename to leads.csv")
        exit(1)
    leads = []
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            email = row.get("Email", "").strip()
            if not email:
                continue
            company = (row.get("Organization Name") or row.get("Company") or row.get("Account Name") or "").strip()
            leads.append({
                "first_name":   row.get("First Name", "").strip(),
                "last_name":    row.get("Last Name", "").strip(),
                "email":        email,
                "title":        row.get("Title", "").strip(),
                "company":      company,
                "industry":     row.get("Industry", "").strip(),
                "company_size": (row.get("# Employees") or row.get("Employees") or "").strip(),
                "linkedin_url": row.get("LinkedIn Url", "").strip(),
                "city":         row.get("City", "").strip(),
                "country":      row.get("Country", "").strip(),
            })
    print(f"[CSV] Loaded {len(leads)} leads from {csv_path}")
    return leads[:MAX_LEADS]


def call_openrouter(prompt, max_tokens=700):
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://ngnhacks.com",
        "X-Title": "NGN Hacks Outreach",
    }
    body = {
        "model": OPENROUTER_MODEL,
        "max_tokens": max_tokens,
        "temperature": 0.85,
        "messages": [{"role": "user", "content": prompt}],
    }
    for attempt in range(5):
        res = requests.post("https://openrouter.ai/api/v1/chat/completions", headers=headers, json=body, timeout=60)
        if res.status_code == 429:
            wait = 15 * (attempt + 1)
            print(f"         [Rate limit] Waiting {wait}s...")
            time.sleep(wait)
            continue
        res.raise_for_status()
        break
    else:
        raise Exception("Rate limit exceeded after 5 retries.")
    raw = res.json()["choices"][0]["message"]["content"].strip()
    raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
    raw = re.sub(r"<thinking>.*?</thinking>", "", raw, flags=re.DOTALL).strip()
    return raw


PLACEHOLDER_RE = re.compile(r"[\[\{][^\]\}]{0,50}[\]\}]")  # [anything] or {anything}


def _clean_dashes(text):
    # em/en dash -> comma (per outreach style); normalize other unicode punctuation to plain ASCII
    repl = {
        "\u2014": ",", "\u2013": ",",                 # em / en dash -> comma
        "\u2011": "-", "\u2010": "-", "\u2212": "-",   # non-breaking / unicode hyphen / minus
        "\u2019": "'", "\u2018": "'",                 # smart single quotes
        "\u201c": '\"', "\u201d": '\"',               # smart double quotes
        "\u2026": "...",                              # ellipsis
    }
    for k, v in repl.items():
        text = text.replace(k, v)
    # Normalize every exotic unicode space (NBSP, narrow NBSP U+202F, thin/hair/ideographic
    # spaces) to a plain ASCII space, then strip zero-width characters.
    text = re.sub(r"[\u00a0\u2000-\u200a\u202f\u205f\u3000]", " ", text)
    text = re.sub(r"[\u200b\u200c\u200d\ufeff]", "", text)
    return text


def has_placeholder(text):
    """True if the text still contains an unfilled [placeholder] / {placeholder}."""
    return bool(PLACEHOLDER_RE.search(text))


def strip_placeholders(text):
    return re.sub(r"\s*" + PLACEHOLDER_RE.pattern, "", text).strip()


def format_body(body, first_name):
    """Guarantee a 'Hey {name},' greeting on its own line, blank lines between paragraphs."""
    body = body.strip()
    body = re.sub(r"\n[ \t]+", "\n", body)        # trim leading space on each line
    body = re.sub(r"\n{3,}", "\n\n", body)        # collapse big gaps to one blank line
    lines = body.split("\n")
    first_line = lines[0].strip().lower() if lines else ""
    if any(first_line.startswith(w) for w in ("hi", "hey", "hello", "dear")):
        # greeting present: make sure a blank line follows it
        if len(lines) > 1 and lines[1].strip() != "":
            lines.insert(1, "")
            body = "\n".join(lines)
    else:
        name = first_name.strip() or "there"
        body = f"Hey {name},\n\n{body}"
    return re.sub(r"\n{3,}", "\n\n", body).strip()


def build_prompt(lead):
    linkedin_note = f"LinkedIn: {lead['linkedin_url']}" if lead["linkedin_url"] else "LinkedIn: not available"
    location_note = f"{lead['city']}, {lead['country']}" if lead["city"] else lead["country"]
    first = lead["first_name"] or "there"
    return f"""Act like a cold emailer with 200+ IQ and 20+ years of experience. You are working for NGN Hacks, an international high school hackathon looking to get sponsorships for prize money.

LEAD INFO (use these REAL values directly, never write a placeholder):
- First name: {first}
- Full name: {lead["first_name"]} {lead["last_name"]}
- Title: {lead["title"]}
- Company: {lead["company"]}
- Industry: {lead["industry"]}
- Company Size: {lead["company_size"]} employees
- Location: {location_note}
- {linkedin_note}

ABOUT NGN HACKS:
- International virtual high school hackathon, August 7-9
- 100+ participants from 20+ countries
- Backed by: Gen AI, Featherless AI, Town of Aurora, YC-backed founders, CTO of Mozilla
- Over 600,000 Instagram views in 90 days, fastest growing student hackathon in Canada
- 500+ ambitious Gen Z builders (future founders, engineers, CTOs)
- Sponsorship benefits: logo placement, social shoutouts, direct access to top student talent pipeline

OUTPUT ONLY this exact format and nothing else:

SUBJECT: <one short subject line>

EMAIL:
Hey {first},

<paragraph one>

<paragraph two>

Best,
{SENDER_NAME}

CRITICAL FORMATTING:
- Write the ACTUAL name "{first}" and company "{lead['company']}". NEVER output square brackets, curly braces, or placeholders like [name], [company], [angle]. If you are unsure of a detail, leave it out entirely.
- Put a BLANK LINE between the greeting, each paragraph, and the signature. Do not cram lines together.

SUBJECT LINE: short, hyper-personalized, impossible not to open, no cliches, no AI patterns. Write it fully filled in, no brackets.
Good examples (style only): "random but your network might power our next 500 builders (jk, unless?)" / "what if your next power users are still in high school"

EMAIL BODY rules:
1. Open with a hyper-personalized TRUE fact about them or {lead['company']}, connect it to NGN Hacks
2. Introduce yourself and NGN Hacks with proof: 600k views in 90 days, 100+ participants, 20+ countries, YC-backed
3. One clear CTA: ask for 10 minutes next week to explore sponsorship
4. Sign as {SENDER_NAME}
5. Under 120 words, punchy, human, no fluff
6. No em dashes, use commas instead"""


def _parse_response(response, lead):
    if "SUBJECT:" in response and "EMAIL:" in response:
        parts = response.split("EMAIL:", 1)
        subject = parts[0].replace("SUBJECT:", "").strip().split("\n")[0].strip()
        body = parts[1].strip()
    else:
        subject = f"NGN Hacks x {lead['company']}: 500 young builders"
        body = response.strip()
    return subject, body


def generate_email_and_subject(lead):
    prompt = build_prompt(lead)
    result = None
    for attempt in range(3):
        response = call_openrouter(prompt)
        subject, body = _parse_response(response, lead)
        subject = _clean_dashes(subject)
        body = format_body(_clean_dashes(body), lead["first_name"])
        result = {"subject": subject, "body": body}
        if not has_placeholder(subject) and not has_placeholder(body):
            return result
        print(f"         [retry] placeholder detected, regenerating ({attempt + 1}/3)...")
    # Last resort: scrub any remaining placeholders so nothing ugly ever sends.
    result["subject"] = strip_placeholders(result["subject"]) or f"NGN Hacks x {lead['company']}"
    result["body"] = format_body(strip_placeholders(result["body"]), lead["first_name"])
    return result


def save_to_sent(raw):
    """Append a copy of the sent message to the IMAP Sent folder so it shows in webmail."""
    try:
        with imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT) as imap:
            imap.login(PRIVATEMAIL_USER, PRIVATEMAIL_PASS)
            imap.append(SENT_FOLDER, "\\Seen", imaplib.Time2Internaldate(time.time()), raw.encode("utf-8"))
    except Exception as e:
        print(f"         [warn] sent OK but could not save copy to Sent folder: {e}")


def build_message(to_email, subject, body):
    msg = MIMEMultipart("alternative")
    msg["Subject"]    = subject
    msg["From"]       = f"{SENDER_NAME} | NGN Hacks <{PRIVATEMAIL_USER}>"
    msg["To"]         = to_email
    msg["Date"]       = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain=PRIVATEMAIL_USER.split("@")[-1])
    msg.attach(MIMEText(body, "plain"))
    return msg


def send_email(to_email, subject, body):
    msg = build_message(to_email, subject, body)
    raw = msg.as_string()
    with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT) as server:
        server.login(PRIVATEMAIL_USER, PRIVATEMAIL_PASS)
        server.sendmail(PRIVATEMAIL_USER, to_email, raw)
    save_to_sent(raw)


def log_to_csv(results, filename):
    if not results:
        return
    fieldnames = ["first_name", "last_name", "email", "title", "company", "subject", "body", "status", "timestamp"]
    with open(filename, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in results:
            writer.writerow({k: r.get(k, "") for k in fieldnames})
    print(f"\n[Log] Saved to {filename}")


def run_campaign(dry_run=True):
    print("=" * 60)
    print("  NGN Hacks Sponsorship Outreach Pipeline")
    print(f"  Model : {OPENROUTER_MODEL}")
    print(f"  Mode  : {'DRY RUN' if dry_run else 'LIVE SEND'}")
    print("=" * 60 + "\n")

    leads   = get_apollo_leads("leads.csv")
    results = []

    for i, lead in enumerate(leads, 1):
        name  = f"{lead['first_name']} {lead['last_name']}"
        print(f"[{i}/{len(leads)}] {name} | {lead['title']} @ {lead['company']}")
        print(f"         Email: {lead['email']}")
        try:
            gen     = generate_email_and_subject(lead)
            subject = gen["subject"]
            body    = gen["body"]
            print(f"         Subject: {subject}")
            print(f"         ---\n{body}\n")
            status = "preview"
            if not dry_run:
                send_email(lead["email"], subject, body)
                status = "sent"
                print("         Sent!\n")
            results.append({**lead, "subject": subject, "body": body, "status": status, "timestamp": datetime.now().isoformat()})
        except Exception as e:
            print(f"         Error: {e}\n")
            results.append({**lead, "subject": "", "body": "", "status": f"error: {e}", "timestamp": datetime.now().isoformat()})

        if i < len(leads):
            time.sleep(4)

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_to_csv(results, f"ngn_hacks_campaign_{ts}.csv")
    print(f"\n{'='*60}")
    print(f"  Done. {len([r for r in results if r['status'] in ('sent','preview')])} emails processed.")
    print(f"{'='*60}")


if __name__ == "__main__":
    import sys
    # Safety: dry run by default. Pass --live (or --send) to actually send emails.
    live = any(flag in sys.argv for flag in ("--live", "--send"))
    run_campaign(dry_run=not live)
