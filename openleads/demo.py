"""
A synthetic demo workspace — for trying the dashboard without touching your data.

``openleads demo`` points ``OPENLEADS_HOME`` at a throwaway directory, calls
:func:`seed`, and opens the dashboard. Every company uses a reserved ``.example``
domain and every person is invented, so nothing here is real contact data and no
mail can ever be delivered to it.

The data is shaped like a few weeks of real use: contacts at a dozen companies
with tiers, evidence, stages and fit scores; lists and tags; two sequences with
people at different steps; tasks due today and overdue; a deal pipeline; notes;
and a send log with replies, so every page has something to show.
"""
from __future__ import annotations

import random
import time

DAY = 86400

COMPANIES = [
    # (name, domain, industry, employees, city, state, country, technologies, source)
    ("Northwind Dental", "northwind-dental.example", "Dental", "24", "Austin", "TX", "US",
     ["WordPress", "Zocdoc", "Google Analytics", "Podium"], "local"),
    ("Brightside Marketing", "brightside.example", "Marketing & advertising", "85", "Miami", "FL", "US",
     ["HubSpot", "WordPress", "Hotjar", "Google Tag Manager"], "local"),
    ("Copperleaf Legal", "copperleaf.example", "Legal services", "32", "London", "", "GB",
     ["Squarespace", "Calendly"], "local"),
    ("Helio Payments", "heliopay.example", "Fintech", "260", "New York", "NY", "US",
     ["Next.js", "Segment", "Stripe", "Intercom"], "yc"),
    ("Lumen Robotics", "lumenrobotics.example", "Software", "140", "Berlin", "", "DE",
     ["React", "HubSpot", "Cloudflare"], "github"),
    ("Pinecrest Fitness", "pinecrest.example", "Fitness", "9", "Denver", "CO", "US",
     ["Mindbody", "Wix"], "local"),
    ("Harbor & Co Accounting", "harborco.example", "Accounting", "41", "Toronto", "ON", "CA",
     ["WordPress", "Google Analytics"], "local"),
    ("Atlas Freight", "atlasfreight.example", "Logistics", "640", "Chicago", "IL", "US",
     ["Salesforce", "Marketo", "Google Tag Manager"], "companies"),
    ("Quill Studio", "quillstudio.example", "Design", "7", "Lisbon", "", "PT",
     ["Webflow", "Framer"], "local"),
    ("Verdant Clinics", "verdantclinics.example", "Medical practice", "120", "Austin", "TX", "US",
     ["Jane App", "WordPress", "Meta Pixel"], "local"),
    ("Orbit Analytics", "orbitanalytics.example", "Software", "38", "San Francisco", "CA", "US",
     ["Next.js", "PostHog", "Stripe", "Vercel"], "yc"),
    ("Sable Coffee Roasters", "sablecoffee.example", "Food & beverage", "28", "Seattle", "WA", "US",
     ["Shopify", "Klaviyo", "Toast"], "local"),
]

PEOPLE = [
    # (company index, first, last, title)
    (0, "Maya", "Okafor", "Owner & Lead Dentist"), (0, "Daniel", "Reyes", "Practice Manager"),
    (0, "Priya", "Shah", "Office Manager"),
    (1, "Jordan", "Blake", "Founder & CEO"), (1, "Elena", "Marsh", "VP of Client Services"),
    (1, "Theo", "Lindqvist", "Head of Growth"), (1, "Sofia", "Duarte", "SEO Specialist"),
    (2, "Harriet", "Cole", "Managing Partner"), (2, "Oliver", "Grant", "Senior Associate"),
    (3, "Amara", "Nwosu", "Co-Founder & CTO"), (3, "Lucas", "Ferreira", "VP of Sales"),
    (3, "Grace", "Liu", "Director of Marketing"), (3, "Ben", "Avery", "Account Executive"),
    (3, "Nina", "Kowalski", "Head of People"),
    (4, "Jonas", "Weber", "CEO"), (4, "Leonie", "Braun", "Engineering Manager"),
    (4, "Felix", "Hartmann", "Senior Software Engineer"),
    (5, "Kayla", "Moreno", "Owner"), (5, "Marcus", "Hill", "Head Coach"),
    (6, "Samuel", "Osei", "Partner, CPA"), (6, "Claire", "Dubois", "Tax Manager"),
    (7, "Victor", "Petrov", "Chief Operating Officer"), (7, "Rachel", "Kim", "Director of Procurement"),
    (7, "Tom", "Brennan", "VP of Sales"), (7, "Aisha", "Rahman", "Logistics Coordinator"),
    (8, "Inês", "Carvalho", "Founder & Creative Director"), (8, "Rui", "Matos", "Product Designer"),
    (9, "Hannah", "Fischer", "Medical Director"), (9, "David", "Park", "Operations Manager"),
    (9, "Laura", "Bennett", "Head of Patient Experience"),
    (10, "Ethan", "Cole", "Co-Founder & CEO"), (10, "Mei", "Tanaka", "Head of Product"),
    (10, "Sam", "Rivera", "Growth Marketing Manager"),
    (11, "Isabel", "Ortiz", "Owner"), (11, "Noah", "Fraser", "Wholesale Manager"),
]

TEMPLATE_PITCH = ("We help growing teams fill their calendar with qualified meetings, "
                  "without buying a contact database.")


def _email(first: str, last: str, domain: str, style: int) -> str:
    from openleads.emails.permute import ascii_fold
    f, la = ascii_fold(first).lower(), ascii_fold(last).lower()
    return [f"{f}.{la}@{domain}", f"{f}@{domain}", f"{f[0]}{la}@{domain}"][style % 3]


def seed(db, now: float | None = None, rng_seed: int = 7) -> dict:
    """Fill ``db`` with the demo workspace. Returns counts of what was created."""
    from openleads.workspace import (
        deals,
        lists,
        notes,
        people,
        scoring,
        sequences,
        tags,
        tasks,
        templates,
    )
    rnd = random.Random(rng_seed)
    now = time.time() if now is None else now
    emails: list = []
    by_company: dict = {}
    for i, (ci, first, last, title) in enumerate(PEOPLE):
        name, domain, industry, emp, city, state, country, tech, source = COMPANIES[ci]
        email = _email(first, last, domain, i)
        tier = "safe" if rnd.random() < 0.78 else "risky"
        evidence = rnd.choice(["found", "found", "pattern", "pattern", "guessed"]) if tier == "safe" \
            else "guessed"
        signals = {"groundtruth_exact": True} if evidence == "found" else \
            {"observed_pattern": True} if evidence == "pattern" else {}
        db.upsert_lead({
            "email": email, "first_name": first, "last_name": last, "title": title,
            "organization": name, "industry": industry, "employees": emp, "city": city,
            "state": state, "country": country, "website": f"https://{domain}",
            "tier": tier, "score": rnd.randint(78, 98) if tier == "safe" else rnd.randint(45, 70),
            "confidence_pct": rnd.randint(80, 97) if tier == "safe" else rnd.randint(40, 65),
            "source": source, "signals": signals,
            "phone": f"+1512555{1000 + i:04d}" if rnd.random() < 0.5 else "",
            "linkedin_url": f"https://www.linkedin.com/in/{first.lower()}-{last.lower()}-demo"
            if rnd.random() < 0.6 else "",
            "technologies": tech,
            "socials": {"linkedin": f"https://www.linkedin.com/company/{domain.split('.')[0]}"},
            "description": f"{name} — {industry.lower()} in {city}.",
        })
        created = now - rnd.uniform(0, 28) * DAY
        db.execute("UPDATE leads SET created=?, updated=? WHERE email=?", (created, created, email))
        emails.append(email)
        by_company.setdefault(ci, []).append(email)

    # Two people who also came in from an import under another address — the
    # duplicates a real workspace collects (Data health → merge).
    for i in (3, 13):
        ci, first, last, _title = PEOPLE[i]
        domain = COMPANIES[ci][1]
        db.upsert_lead({"email": _email(first, last, domain, 2), "first_name": first,
                        "last_name": last, "title": "", "organization": COMPANIES[ci][0],
                        "tier": "risky", "score": 52, "evidence": "guessed", "source": "import",
                        "phone": f"+1512555{3000 + i:04d}"})

    # Company profiles (tech stack, phone) as if fetched from their homepages.
    from openleads.workspace import companies
    for ci, (name, domain, industry, emp, city, state, country, tech, _src) in enumerate(COMPANIES):
        companies.apply_profile(db, domain, {
            "name": name, "description": f"{name} is a {industry.lower()} business in {city}.",
            "industry": industry, "phone": f"+1512555{2000 + ci:04d}", "technologies": tech,
            "employees": emp, "size": "", "founded": str(rnd.randint(1998, 2021)),
            "socials": {"linkedin": f"https://www.linkedin.com/company/{domain.split('.')[0]}"},
            "address": {"city": city, "region": state, "country": country}})
    db.execute("UPDATE accounts SET stage='engaged' WHERE domain IN (?, ?)",
               (COMPANIES[3][1], COMPANIES[1][1]))

    # Sequences: one active with people at different steps, one paused draft.
    db.kv_set("demo", True)
    seq = sequences.create(db, "Local practices — Q4", sequences.starter_steps(),
                           {"context": TEMPLATE_PITCH, "skip_weekends": True}, status="active")
    sequences.enroll(db, seq["id"], by_company[0] + by_company[9] + by_company[5] + by_company[11],
                     force=True)
    enr = db.query("SELECT id, email FROM enrollments WHERE sequence_id=?", (seq["id"],))
    for k, e in enumerate(enr):
        step = k % 4
        db.execute("UPDATE enrollments SET step=?, next_due=?, enrolled=? WHERE id=?",
                   (step, now + rnd.uniform(-1, 4) * DAY, now - (8 + k) * DAY, e["id"]))
    sequences.create(db, "Founder outreach", sequences.starter_steps()[:3],
                     {"context": TEMPLATE_PITCH}, status="paused")

    # A send log with a believable shape: sends over the last three weeks, a few replies.
    contacted = emails[:22]
    campaign = f"seq:{seq['id']}"
    for j, email in enumerate(contacted):
        sent_at = now - rnd.uniform(1, 21) * DAY
        db.execute("INSERT INTO touches (email, campaign, step, subject, status, ts) "
                   "VALUES (?,?,?,?,?,?)", (email, campaign, 1, "quick question", "sent", sent_at))
        db.set_status(email, "sent")
        db.execute("UPDATE leads SET last_contacted=? WHERE email=?", (sent_at, email))
        if j % 2 == 0 and rnd.random() < 0.6:
            db.execute("INSERT INTO touches (email, campaign, step, subject, status, ts) "
                       "VALUES (?,?,?,?,?,?)", (email, campaign, 2, "re: quick question", "sent",
                                                sent_at + 3 * DAY))
    for email in contacted[:5]:
        db.set_status(email, "replied")
        db.execute("UPDATE activity SET ts=? WHERE ref=? AND kind='replied'",
                   (now - rnd.uniform(0.2, 9) * DAY, email))
    db.set_status(contacted[6], "bounced")
    people.update(db, contacted[0], {"stage": "meeting"})
    people.update(db, contacted[1], {"stage": "interested"})

    # Lists, tags, notes.
    austin = lists.create(db, "Austin healthcare", color="teal",
                          description="Dental and medical practices in Austin")
    lists.add(db, austin["id"], by_company[0] + by_company[9])
    fintech = lists.create(db, "Q4 fintech targets", color="indigo")
    lists.add(db, fintech["id"], by_company[3] + by_company[10])
    agencies = lists.create(db, "Agencies to call", color="orange")
    lists.add(db, agencies["id"], by_company[1] + by_company[8])
    tlist = lists.create(db, "Logistics accounts", kind="companies", color="amber")
    lists.add(db, tlist["id"], [COMPANIES[7][1], COMPANIES[3][1]])
    tags.add(db, emails[:4] + emails[9:12], "hot")
    tags.add(db, emails[3:8], "conference-2026")
    tags.add(db, [emails[9], emails[14]], "warm-intro")
    notes.add(db, "contact", emails[0], "Prefers a call before 10am. Interested in the "
                                        "spring promotion — follow up with the case study.",
              pinned=True)
    notes.add(db, "contact", emails[9], "Met at FinTech Week. Wants to see the API docs.")
    notes.add(db, "company", COMPANIES[3][1], "Budget cycle resets in January.")

    # Tasks: overdue, today and upcoming.
    t_specs = [
        ("Call Maya about the case study", "call", emails[0], -2),
        ("Send pricing deck to Lucas", "email", emails[10], 0),
        ("Connect with Grace on LinkedIn", "linkedin", emails[11], 0),
        ("Follow up with Jordan after the demo", "email", emails[3], 1),
        ("Prep for Helio Payments QBR", "todo", emails[9], 3),
        ("Call Victor re: freight volumes", "call", emails[21], -1),
        ("Review Copperleaf's proposal feedback", "todo", emails[7], 6),
    ]
    for title, kind, who, days in t_specs:
        due = now + days * DAY
        tasks.create(db, title, kind=kind, contact=who, due=due,
                     priority="high" if days < 0 else "normal")

    # Deals across the pipeline.
    d_specs = [
        ("Helio Payments — platform pilot", emails[10], "proposal", 24000, 21),
        ("Brightside — agency partnership", emails[3], "negotiation", 18000, 9),
        ("Northwind Dental — annual plan", emails[0], "meeting", 6000, 34),
        ("Atlas Freight — enterprise", emails[23], "qualify", 60000, 75),
        ("Orbit Analytics — starter", emails[30], "won", 4800, -6),
        ("Copperleaf Legal — pilot", emails[7], "qualify", 9000, -3),
        ("Pinecrest Fitness", emails[17], "lost", 1200, -12),
    ]
    for name, contact, stage, amount, close_in in d_specs:
        d = deals.create(db, name, contact=contact, amount=amount,
                         close_date=time.strftime("%Y-%m-%d", time.localtime(now + close_in * DAY)))
        if stage != "qualify":
            deals.move(db, d["id"], stage)

    # An ICP that favors decision-makers at small healthcare and software teams.
    scoring.save_model(db, {"departments": {"executive": 10, "sales": 8, "marketing": 8},
                            "industries": {"Dental": 10, "Medical practice": 10, "Software": 8,
                                           "Fintech": 8},
                            "company_sizes": {"11-50": 8, "51-200": 6},
                            "technologies": {"HubSpot": 5, "WordPress": 3}})
    scoring.rescore(db)
    templates.seed_defaults(db)
    return {"contacts": len(emails), "companies": len(COMPANIES), "lists": 4,
            "sequences": 2, "tasks": len(t_specs), "deals": len(d_specs)}
