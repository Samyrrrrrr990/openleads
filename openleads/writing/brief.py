"""
The research brief: everything we already know about one lead, in one place.

:func:`build_brief` is a pure function over a lead (a :class:`~openleads.models.Lead`,
its ``to_dict()``, or a workspace contact row) and the sender's profile. It does no
I/O and no scraping: it only reads fields a search, an import or a company profile
already filled in. Every sentence the writer produces that is *about the lead* must
come from a :class:`Fact` in the brief, which is what makes the "no invented facts"
promise checkable (see :mod:`openleads.writing.quality`).

The brief also carries what the writer needs to sound right without inventing
anything: whether the address is a shared inbox (``info@``) rather than a person,
a clean first name (never the company's first word), the role family and vertical
used to pick wording, and the topic of the sender's pitch.
"""
from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field

# Mailboxes that belong to a team, not a person. Kept in step with
# openleads.emails.permute.ROLE_LOCALS plus the front-desk addresses small
# businesses publish.
ROLE_LOCALS = {
    "info", "admin", "support", "sales", "hello", "contact", "team", "office",
    "help", "billing", "careers", "jobs", "press", "media", "marketing", "hr",
    "legal", "accounts", "enquiries", "inquiries", "general", "mail", "reception",
    "frontdesk", "front.desk", "appointments", "bookings", "booking", "reservations",
    "studio", "clinic", "hi", "hey", "partners", "partnerships", "biz", "business",
    "orders", "shop", "store", "service", "customerservice", "care", "feedback",
    "recruiting", "talent", "work", "hiring", "dentist", "practice", "manager",
}
_NOT_A_TITLE = {"hiring", "researcher", "developer", "team member", "contact", "staff",
                "employee", "member", "business", "company", "team / contact address"}

# --- verticals ---------------------------------------------------------------- #
# (key, words in industry/vertical/description, technologies that imply it)
VERTICALS = (
    ("dental", ("dental", "dentist", "orthodont", "endodont"), ("Zocdoc", "NexHealth")),
    ("medical", ("medical", "clinic", "health", "physician", "doctor", "chiropract",
                 "physio", "therapy", "therapist", "optometr", "veterin", "pharma"),
     ("Jane App",)),
    ("fitness", ("fitness", "gym", "yoga", "pilates", "crossfit", "martial"), ("Mindbody",)),
    ("beauty", ("salon", "spa", "beauty", "barber", "nail", "aesthetic"), ("Vagaro",)),
    ("legal", ("legal", "law", "attorney", "solicitor", "lawyer"), ()),
    ("accounting", ("accounting", "accountant", "bookkeep", "tax", "cpa", "audit"), ()),
    ("home_services", ("plumb", "hvac", "electric", "roofing", "landscap", "cleaning",
                       "contractor", "construction", "pest", "remodel"),
     ("Housecall Pro", "Jobber", "ServiceTitan")),
    ("food", ("restaurant", "cafe", "coffee", "food", "bakery", "bar ", "brew", "catering",
              "roaster"), ("Toast", "OpenTable")),
    ("real_estate", ("real estate", "realtor", "property", "realty", "mortgage"), ()),
    ("ecommerce", ("e-commerce", "ecommerce", "retail", "online store", "apparel", "shop"),
     ("Shopify", "WooCommerce", "BigCommerce", "Magento", "Square Online")),
    ("agency", ("marketing", "advertising", "agency", "creative", "design", "branding",
                "studio", "media"), ()),
    ("fintech", ("fintech", "payment", "financial", "bank", "lending", "insurance"), ()),
    ("logistics", ("logistics", "freight", "shipping", "transport", "supply chain",
                   "trucking", "warehouse"), ()),
    ("research", ("research", "university", "institute", "laborator", "academic"), ()),
    ("software", ("software", "saas", "developer", "platform", "startup", "ai ", "api",
                  "cloud", "data", "tech"), ("Next.js", "Vercel", "Segment", "PostHog")),
)
LOCAL_VERTICALS = {"dental", "medical", "fitness", "beauty", "legal", "accounting",
                   "home_services", "food", "real_estate"}
_SOURCE_VERTICAL = {"github": "developers", "huggingface": "developers", "openalex": "research",
                    "npi": "medical", "yc": "software", "producthunt": "software",
                    "hn": "software"}

# --- the sender's pitch topic --------------------------------------------------- #
# (topic, keywords). First match with the most hits wins.
TOPICS = (
    ("bookings", ("booking", "appointment", "no-show", "no show", "schedul", "patients",
                  "reservation", "empty slots", "chair time", "calendar fill")),
    ("meetings", ("meeting", "pipeline", "outbound", "leads", "prospect", "demo", "sales",
                  "calendar", "deals", "revenue")),
    ("hiring", ("hire", "hiring", "recruit", "candidate", "talent", "job ")),
    ("marketing", ("seo", "ads", "marketing", "traffic", "brand", "social media", "content",
                   "reviews", "google maps", "visibility")),
    ("payments", ("payment", "invoice", "billing", "checkout", "payout", "collections")),
    ("engineering", ("developer", "devops", "deploy", "infrastructure", "ci ", "testing",
                     "code", "api", "engineering", "kubernetes")),
    ("data", ("analytics", "dashboard", "reporting", "insight", "data")),
    ("security", ("security", "compliance", "soc 2", "soc2", "gdpr", "hipaa", "pentest")),
    ("finance", ("bookkeeping", "accounting", "tax", "cash flow", "payroll", "cfo")),
    ("ops", ("automat", "workflow", "operations", "manual work", "spreadsheet", "admin")),
    ("website", ("website", "web design", "landing page", "site")),
    ("customers", ("support", "customer service", "retention", "churn", "onboarding")),
)
TOPIC_OBJECT = {
    "bookings": "bookings and scheduling", "meetings": "booking new sales meetings",
    "hiring": "hiring", "marketing": "marketing", "payments": "payments and invoicing",
    "engineering": "engineering tooling", "data": "reporting", "security": "security reviews",
    "finance": "bookkeeping", "ops": "day-to-day operations", "website": "the website",
    "customers": "customer support", "": "this",
}
TOPIC_SHORT = {
    "bookings": "bookings", "meetings": "sales meetings", "hiring": "hiring",
    "marketing": "marketing", "payments": "payments", "engineering": "dev tooling",
    "data": "reporting", "security": "security reviews", "finance": "bookkeeping",
    "ops": "ops", "website": "your site", "customers": "support", "": "an idea",
}
# Technology categories that say something about a topic (for curiosity openers).
TOPIC_TECH = {
    "bookings": ("Scheduling", "Reviews & messaging", "Point of sale"),
    "meetings": ("CRM", "Marketing automation", "Live chat"),
    "marketing": ("Marketing automation", "Email marketing", "Advertising", "Analytics", "SEO"),
    "payments": ("Payments", "E-commerce", "Point of sale"),
    "data": ("Analytics",),
    "customers": ("Customer support", "Live chat"),
    "website": ("Website builder", "CMS"),
    "engineering": ("JavaScript framework", "Hosting", "Monitoring"),
}
# Categories worth mentioning at all (fonts, CDNs and consent banners are not).
MENTIONABLE_TECH = {"CRM", "Marketing automation", "E-commerce", "Scheduling",
                    "Email marketing", "Payments", "Customer support", "Live chat",
                    "Analytics", "Website builder", "Field service", "Point of sale",
                    "Reviews & messaging", "CMS", "Hosting", "JavaScript framework",
                    "Forms", "A/B testing", "Monitoring"}


@dataclass
class Fact:
    """One thing we know and may say. ``value`` is the exact wording we'd use."""

    key: str            # "signal.hiring", "company.tech", "person.title", …
    label: str          # what the UI shows ("Hiring", "Tech stack")
    value: str
    weight: int = 1     # 1 = basic (name, industry) … 3 = specific (a repo, a post)
    source: str = ""    # where it came from ("HN Who's hiring", "homepage", …)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Brief:
    """What the writer may use for one lead (and nothing else)."""

    email: str = ""
    seed: str = ""                  # stable per lead: drives deterministic choices
    kind: str = "person"            # person | company (a shared inbox)
    first_name: str = ""            # clean: never a company word, never a role mailbox
    last_name: str = ""
    title: str = ""                 # a real job title ('' when it was a bio or a tag)
    bio: str = ""                   # a profile bio that was in the title field
    seniority: str = ""
    department: str = ""
    # leader | sales | marketing | tech | ops | people | finance | clinical | research | general | inbox
    role: str = "general"
    company: str = ""
    domain: str = ""
    website: str = ""
    description: str = ""
    industry: str = ""
    vertical: str = "general"
    local_business: bool = False
    employees: str = ""
    size: str = ""
    technologies: list = field(default_factory=list)
    tech_highlights: list = field(default_factory=list)   # [(name, category)] worth mentioning
    city: str = ""
    region: str = ""
    country: str = ""
    signals: list = field(default_factory=list)            # [{kind, text, detail, source}]
    source: str = ""
    evidence: str = ""              # found | pattern | guessed | none
    tier: str = ""
    confidence_pct: int = 0
    sender: dict = field(default_factory=dict)
    topic: str = ""                 # what the sender's pitch is about (bookings, hiring, …)
    facts: list = field(default_factory=list)              # [Fact]
    gaps: list = field(default_factory=list)               # what's missing, in plain words

    # -- helpers -------------------------------------------------------------- #
    def fact(self, key: str):
        return next((f for f in self.facts if f.key == key), None)

    def has(self, key: str) -> bool:
        return self.fact(key) is not None

    def signal(self, kind: str):
        return next((s for s in self.signals if s.get("kind") == kind), None)

    @property
    def topic_object(self) -> str:
        return TOPIC_OBJECT.get(self.topic, TOPIC_OBJECT[""])

    @property
    def topic_short(self) -> str:
        return TOPIC_SHORT.get(self.topic, TOPIC_SHORT[""])

    def to_dict(self) -> dict:
        d = asdict(self)
        d["facts"] = [f.to_dict() if isinstance(f, Fact) else f for f in self.facts]
        d["tech_highlights"] = [list(t) for t in self.tech_highlights]
        d["sender"] = {k: v for k, v in self.sender.items() if k != "examples"}
        d["topic_object"] = self.topic_object
        return d

    def vocabulary(self) -> set:
        """Lower-case words the brief contains: what a draft may name."""
        parts = [self.first_name, self.last_name, self.title, self.bio, self.company,
                 self.domain, self.description, self.industry, self.city, self.region,
                 self.country, self.employees, self.size, " ".join(self.technologies)]
        parts += [f.value for f in self.facts]
        parts += [f"{s.get('text', '')} {s.get('detail', '')} {s.get('source', '')}"
                  for s in self.signals]
        parts += [str(self.sender.get(k) or "") for k in ("name", "org", "pitch", "offer", "proof")]
        words = set()
        for p in parts:
            words.update(w.lower() for w in re.findall(r"[A-Za-z0-9][A-Za-z0-9.+#&'-]*", p or ""))
            words.update(w.lower().strip(".'") for w in re.findall(r"[A-Za-z0-9]+", p or ""))
        return words


# --- input normalization -------------------------------------------------------- #
def _as_dict(lead) -> dict:
    """A Lead, a lead dict or a workspace row (with its JSON ``data``) → one flat dict."""
    if lead is None:
        return {}
    if hasattr(lead, "to_dict") and not isinstance(lead, dict):
        lead = lead.to_dict()
    d = dict(lead)
    raw = d.get("data")
    if isinstance(raw, str) and raw.strip().startswith("{"):
        try:
            base = json.loads(raw)
        except ValueError:
            base = {}
        if isinstance(base, dict):
            d = {**base, **{k: v for k, v in d.items() if v not in (None, "", [], {})}}
    elif isinstance(raw, dict):
        d = {**raw, **{k: v for k, v in d.items() if v not in (None, "", [], {})}}
    d.pop("data", None)
    for key in ("technologies", "socials", "signals", "extra"):
        val = d.get(key)
        if isinstance(val, str) and val.strip()[:1] in "[{":
            try:
                d[key] = json.loads(val)
            except ValueError:
                pass
    return d


def _s(v) -> str:
    return " ".join(str(v or "").split())


def _techs(v) -> list:
    if isinstance(v, str):
        v = [t.strip() for t in v.split(",")]
    out = []
    for t in v or []:
        t = _s(t)
        if t and t not in out:
            out.append(t)
    return out


def _looks_like_name(word: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’-]{1,24}", word or "")) \
        and not word.isupper()


def clean_first_name(d: dict, company: str, role_inbox: bool) -> str:
    """A first name we can greet, or '' (never "Hi Northwind," for a company)."""
    if role_inbox or (d.get("contact_type") == "company"):
        return ""
    first = _s(d.get("first_name"))
    if not first and d.get("name") and (d.get("last_name") or d.get("contact_type") == "person"):
        first = _s(d["name"]).split(" ")[0]
    if not first:
        return ""
    first = first.split(" ")[0]
    comp_words = {w.lower() for w in re.findall(r"[A-Za-z]+", company or "")}
    name_full = _s(d.get("name"))
    if company and name_full and name_full.lower() == company.lower():
        return ""                    # the "name" is the company
    if first.lower() in comp_words and not _s(d.get("last_name")):
        return ""
    if not _looks_like_name(first):
        return ""
    return first[:1].upper() + first[1:] if first.islower() else first


def _clean_title(title: str) -> tuple:
    """``(title, bio)``: a GitHub bio or a source tag is not a job title."""
    t = _s(title)
    if not t or t.lower() in _NOT_A_TITLE:
        return "", ""
    from openleads.insights.titles import classify
    sen, dep = classify(t)
    bio_like = "|" in t or len(t) > 60 or t.endswith(".") or bool(re.search(
        r"\b(building|working on|i |i'm|love|passionate|ex-|making)\b", t, re.I))
    if bio_like and not (dep or sen not in ("", "entry")):
        return "", t[:140]
    if bio_like and len(t) > 60:
        return "", t[:140]
    return t, ""


def _role(kind: str, seniority: str, department: str, title: str) -> str:
    if kind == "company":
        return "inbox"
    low = title.lower()
    if re.search(r"\b(practice|office|operations|clinic|general) manager\b", low):
        return "ops"
    if seniority in ("owner", "founder", "c_suite", "partner") or department == "executive":
        return "leader"
    return {"sales": "sales", "marketing": "marketing", "engineering": "tech", "it": "tech",
            "data": "tech", "product": "tech", "design": "tech", "operations": "ops",
            "customer_success": "ops", "hr": "people", "finance": "finance",
            "medical": "clinical", "research": "research", "legal": "ops"}.get(department, "general")


def _vertical(d: dict, techs: list) -> str:
    hay = " ".join(_s(d.get(k)) for k in ("industry", "vertical", "description")).lower() + " "
    for key, words, tech_hints in VERTICALS:
        if any(w in hay for w in words) or any(t in techs for t in tech_hints):
            return key
    return _SOURCE_VERTICAL.get(_s(d.get("source")).lower(), "general")


def pitch_topic(text: str) -> str:
    low = f" {(text or '').lower()} "
    best, hits = "", 0
    for topic, words in TOPICS:
        n = sum(1 for w in words if w in low)
        if n > hits:
            best, hits = topic, n
    return best


def _description(desc: str, company: str, industry: str, city: str) -> str:
    """The homepage one-liner, or '' when it only restates name/industry/city."""
    desc = _s(desc)
    if not desc or len(desc) < 20:
        return ""
    known = {w.lower() for w in re.findall(r"[A-Za-z]+", f"{company} {industry} {city}")}
    filler = {"a", "an", "the", "is", "in", "of", "and", "business", "company", "based"}
    rest = [w for w in re.findall(r"[A-Za-z]+", desc.lower()) if w not in known | filler]
    if len(rest) < 3:
        return ""
    desc = re.split(r"(?<=[.!?])\s", desc)[0].strip()
    return desc[:160].rstrip(" ,;:")


def _signals(d: dict, title_raw: str) -> list:
    """Recent, checkable signals the source handed us (hiring, YC, a post, a repo, …)."""
    out = []
    extra = d.get("extra") if isinstance(d.get("extra"), dict) else {}
    src = _s(d.get("source")).lower()
    vertical = _s(d.get("vertical")).lower()
    get = lambda *keys: next((_s(extra.get(k) or d.get(k)) for k in keys  # noqa: E731
                              if _s(extra.get(k) or d.get(k))), "")
    hiring_for = get("hiring_for", "hiring_role", "job_title")
    if src == "hn" or "hiring" in vertical or title_raw.lower() == "hiring" or get("hiring"):
        where = "Hacker News' Who is hiring thread" if src == "hn" else ""
        out.append({"kind": "hiring", "text": "is hiring", "detail": hiring_for,
                    "source": where or "the source listing"})
        summary = get("summary", "hn_post", "post")
        if src == "hn" and summary:
            out.append({"kind": "hn_post", "text": summary[:160], "detail": "",
                        "source": "Hacker News"})
    batch = get("yc_batch", "batch")
    if src == "yc" or batch:
        out.append({"kind": "yc", "text": "is a Y Combinator company",
                    "detail": batch, "source": "Y Combinator directory"})
    repo = get("repo", "top_repo", "repository")
    if repo or src == "github":
        out.append({"kind": "github", "text": repo or "your profile",
                    "detail": get("repo_description"), "source": "GitHub"})
    paper = get("paper", "paper_title", "work_title", "top_work")
    if paper:
        out.append({"kind": "paper", "text": paper[:140], "detail": get("venue", "year"),
                    "source": "OpenAlex"})
    if src == "producthunt":
        out.append({"kind": "producthunt", "text": get("summary", "tagline")[:140],
                    "detail": "", "source": "Product Hunt"})
    if src == "huggingface" and get("huggingface"):
        out.append({"kind": "huggingface", "text": get("huggingface"), "detail": "",
                    "source": "Hugging Face"})
    return out


# --- the builder ------------------------------------------------------------------ #
def build_brief(lead, sender: dict | None = None) -> Brief:
    """Everything we know about ``lead`` that a draft may use. Pure: no I/O."""
    from openleads.insights import companysize, techstack
    from openleads.insights.titles import classify
    from openleads.models import evidence_of
    d = _as_dict(lead)
    sender = dict(sender or {})
    email = _s(d.get("email")).lower()
    local = email.split("@", 1)[0] if "@" in email else ""
    domain = _s(d.get("domain")) or (email.split("@", 1)[1] if "@" in email else "")
    company = _s(d.get("organization") or d.get("company") or d.get("account_name"))
    role_inbox = local in ROLE_LOCALS or local.split(".")[0] in ROLE_LOCALS
    ctype = _s(d.get("contact_type")).lower()
    named = bool(d.get("first_name") or d.get("last_name")
                 or (d.get("name") and _s(d.get("name")).lower() != company.lower()))
    if role_inbox or ctype == "company":
        kind = "company"
    elif ctype == "person":
        kind = "person"
    else:
        kind = "person" if named else "company"
    first = clean_first_name(d, company, kind == "company")
    title_raw = _s(d.get("title"))
    title, bio = _clean_title(title_raw) if kind == "person" else ("", "")
    seniority, department = _s(d.get("seniority")), _s(d.get("department"))
    if title and not (seniority or department):
        seniority, department = classify(title)
    techs = _techs(d.get("technologies"))
    cat = {n: c for n, c, _ in techstack.SIGNATURES}
    highlights = [(t, cat.get(t, "")) for t in techs if cat.get(t, "") in MENTIONABLE_TECH][:4]
    industry = _s(d.get("industry"))
    city, region, country = _s(d.get("city")), _s(d.get("state") or d.get("region")), \
        _s(d.get("country"))
    employees = _s(d.get("employees"))
    size = _s(d.get("company_size")) or companysize.bucket(employees)
    vertical = _vertical(d, techs)
    desc = _description(d.get("description") or d.get("summary") if d.get("source") != "hn"
                        else d.get("description"), company, industry, city)
    signals = _signals(d, title_raw)
    evidence = _s(d.get("evidence")) or (evidence_of(email, d.get("signals")
                                                     if isinstance(d.get("signals"), dict)
                                                     else {}) if email else "none")
    pitch = _s(sender.get("pitch"))
    b = Brief(
        email=email, seed=email or f"{first}|{company}".lower(), kind=kind,
        first_name=first, last_name=_s(d.get("last_name")) if first else "",
        title=title, bio=bio, seniority=seniority, department=department,
        role=_role(kind, seniority, department, title), company=company, domain=domain,
        website=_s(d.get("website")), description=desc, industry=industry,
        vertical=vertical, local_business=vertical in LOCAL_VERTICALS,
        employees=employees, size=size, technologies=techs, tech_highlights=highlights,
        city=city, region=region, country=country, signals=signals,
        source=_s(d.get("source")), evidence=evidence, tier=_s(d.get("tier")),
        confidence_pct=int(d.get("confidence_pct") or 0) if str(
            d.get("confidence_pct") or "0").isdigit() else 0,
        sender={"name": _s(sender.get("name")), "org": _s(sender.get("org")), "pitch": pitch,
                "offer": _s(sender.get("offer")), "proof": _s(sender.get("proof")),
                "tone": _s(sender.get("tone")) or "plain",
                "examples": str(sender.get("examples") or "").strip()},
        topic=pitch_topic(f"{pitch} {sender.get('offer') or ''}"),
    )
    b.facts = _facts(b)
    b.gaps = _gaps(b)
    return b


def _facts(b: Brief) -> list:
    f = []
    if b.first_name:
        f.append(Fact("person.first_name", "First name", b.first_name, 0, "contact"))
    if b.company:
        f.append(Fact("company.name", "Company", b.company, 0, "contact"))
    if b.title:
        f.append(Fact("person.title", "Title", b.title, 1, "contact"))
    if b.bio:
        f.append(Fact("person.bio", "Profile bio", b.bio, 2, "profile"))
    for s in b.signals:
        label = {"hiring": "Hiring", "yc": "Y Combinator", "hn_post": "HN post",
                 "github": "GitHub", "paper": "Paper", "producthunt": "Product Hunt",
                 "huggingface": "Hugging Face"}.get(s["kind"], s["kind"])
        value = s["text"] + (f" ({s['detail']})" if s.get("detail") else "")
        f.append(Fact(f"signal.{s['kind']}", label, value, 3, s.get("source", "")))
    if b.description:
        f.append(Fact("company.description", "What they do", b.description, 2, "homepage"))
    if b.tech_highlights:
        f.append(Fact("company.tech", "Tech stack", ", ".join(t for t, _ in b.tech_highlights),
                      2, "homepage"))
    if b.industry:
        f.append(Fact("company.industry", "Industry", b.industry, 1, "source"))
    if b.employees or b.size:
        f.append(Fact("company.size", "Team size",
                      f"{b.employees} people" if b.employees else f"{b.size} people", 1,
                      "profile"))
    if b.city:
        f.append(Fact("company.location", "Location",
                      ", ".join(p for p in (b.city, b.region or b.country) if p), 1, "source"))
    return f


def _gaps(b: Brief) -> list:
    g = []
    if not b.sender.get("pitch"):
        g.append("No pitch set (Settings, Sender identity): drafts can't say what you offer.")
    if not b.sender.get("name"):
        g.append("No sender name set: drafts sign off without a name.")
    if b.kind == "person" and not b.first_name:
        g.append("No usable first name: the greeting is 'Hi there'.")
    if not any(f.weight >= 2 for f in b.facts):
        g.append("Nothing specific known about this lead beyond name, title and company.")
    if b.evidence in ("guessed", "none"):
        g.append("The address is a guess: it may bounce.")
    return g


def sender_profile(overrides: dict | None = None) -> dict:
    """The sender's identity, pitch and voice from Settings (``overrides`` win).

    Accepts the old ``compose`` override names too (``context``, ``sender``, ``org``).
    """
    from openleads import settings
    o = dict(overrides or {})
    alias = {"context": "pitch", "sender_context": "pitch", "sender": "name",
             "sender_name": "name", "sender_org": "org", "sender_offer": "offer",
             "sender_proof": "proof", "writing_tone": "tone", "writing_examples": "examples"}
    for old, new in alias.items():
        if o.get(old) not in (None, "") and o.get(new) in (None, ""):
            o[new] = o[old]
    base = {
        "name": settings.get("sender_name") or "",
        "org": settings.get("sender_org") or "",
        "pitch": settings.get("sender_context") or "",
        "offer": settings.get("sender_offer") or "",
        "proof": settings.get("sender_proof") or "",
        "tone": settings.get("writing_tone") or "plain",
        "examples": settings.get("writing_examples") or "",
    }
    base.update({k: v for k, v in o.items() if k in base and v not in (None, "")})
    return base
