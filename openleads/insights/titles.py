"""
Seniority and department from a job title.

``classify("VP of Marketing")`` → ``("vp", "marketing")``. These are the two filters
B2B tools are used through most ("directors and above in sales"), and every source
gives us a free-text title, so we infer both instead of leaving them blank.

The rules are ordered keyword patterns, first match wins. Ambiguity resolves toward
what a seller would want: "Managing Director" is the person running the company
(``c_suite``), "Partner Manager" is a manager, "Sales Engineer" sits in sales.
"""
from __future__ import annotations

import re

# (key, label) in descending order of seniority — the order the UI lists them.
SENIORITIES = (
    ("owner", "Owner"),
    ("founder", "Founder"),
    ("c_suite", "C-Suite"),
    ("partner", "Partner"),
    ("vp", "VP"),
    ("head", "Head"),
    ("director", "Director"),
    ("manager", "Manager"),
    ("senior", "Senior"),
    ("entry", "Entry"),
    ("intern", "Intern"),
)
SENIORITY_LABELS = dict(SENIORITIES)
SENIORITY_RANK = {k: i for i, (k, _) in enumerate(SENIORITIES)}

DEPARTMENTS = (
    ("executive", "Executive"),
    ("engineering", "Engineering"),
    ("product", "Product"),
    ("design", "Design"),
    ("data", "Data & Analytics"),
    ("marketing", "Marketing"),
    ("sales", "Sales"),
    ("customer_success", "Customer Success"),
    ("operations", "Operations"),
    ("finance", "Finance"),
    ("hr", "People & HR"),
    ("legal", "Legal"),
    ("it", "IT & Security"),
    ("medical", "Medical & Health"),
    ("research", "Research & Education"),
    ("consulting", "Consulting"),
    ("media", "Media & Communications"),
)
DEPARTMENT_LABELS = dict(DEPARTMENTS)

# Titles that say nothing about the person (company contacts, placeholders).
_NON_TITLES = {"", "team member", "team / contact address", "contact", "staff",
               "business", "company", "member", "employee"}


def _rx(*words: str) -> re.Pattern:
    return re.compile(r"\b(?:" + "|".join(words) + r")\b", re.I)


# --- seniority: first match wins ------------------------------------------- #
_SENIORITY_RULES = (
    ("intern", _rx(r"intern", r"internship", r"trainee", r"apprentice", r"working student")),
    ("founder", _rx(r"co-?founder", r"founder", r"founding (?:partner|member|ceo|cto)")),
    ("owner", re.compile(r"(?<!product )(?<!process )(?<!business )\b(?:co-?owner|owner|"
                         r"proprietor)\b", re.I)),
    ("vp", _rx(r"vp", r"svp", r"evp", r"avp", r"vice[- ]president", r"vice[- ]chair")),
    ("c_suite", _rx(r"c[a-z]{1,2}o", r"chief", r"president", r"managing director",
                    r"executive director", r"general partner", r"chair(?:man|woman|person)?",
                    r"board member", r"md")),
    ("partner", re.compile(
        r"\b(?:managing |senior |equity |founding |name )?partner\b"
        r"(?!\s*(?:manager|marketing|success|programs?|relations|development|sales|"
        r"engineer|enablement|operations|ships?))", re.I)),
    ("head", _rx(r"head of", r"head", r"global head")),
    ("director", _rx(r"director", r"dir\.?")),
    ("manager", _rx(r"manager", r"mgr", r"supervisor", r"team lead", r"team leader",
                    r"general manager", r"store manager", r"office manager")),
    ("senior", _rx(r"senior", r"sr\.?", r"principal", r"staff", r"lead", r"expert",
                   r"specialist ii+", r"professor", r"physician", r"surgeon", r"dentist",
                   r"attorney", r"lawyer", r"counsel", r"architect", r"consultant")),
)

def seniority(title: str) -> str:
    """The seniority key for ``title`` ('' when the title says nothing)."""
    t = _normalize(title)
    if not t:
        return ""
    for key, rx in _SENIORITY_RULES:
        if key == "c_suite":
            if any(not _is_false_chief(t, m) for m in rx.finditer(t)):
                return key
            continue
        if rx.search(t):
            return key
    return "entry"


def _is_false_chief(t: str, m: re.Match) -> bool:
    """'cto' is C-suite; 'demo', 'repo', 'cmo' inside words are not (word-bounded)."""
    tok = m.group(0).lower()
    if len(tok) in (3, 4) and tok.startswith("c") and tok.endswith("o"):
        return tok not in _C_ACRONYMS
    if tok == "md":
        # "MD" after a name is a degree; as a title on its own it's a managing director.
        return t.strip().lower() != "md"
    return False


_C_ACRONYMS = {"ceo", "cto", "coo", "cfo", "cmo", "cpo", "cio", "cso", "cro", "cdo",
               "cco", "cao", "cxo", "chro", "ciso", "clo", "cbo", "cno"}

# --- department ------------------------------------------------------------ #
_CHIEF = {
    "ceo": "executive", "coo": "operations", "cto": "engineering", "cfo": "finance",
    "cmo": "marketing", "cpo": "product", "cio": "it", "ciso": "it", "cso": "sales",
    "cro": "sales", "cdo": "data", "cco": "customer_success", "chro": "hr", "clo": "legal",
    "cno": "medical", "cao": "finance", "cbo": "sales", "cxo": "executive",
}
_CHIEF_WORDS = (
    ("executive", "executive"), ("operating", "operations"), ("operations", "operations"),
    ("technology", "engineering"), ("technical", "engineering"), ("financial", "finance"),
    ("finance", "finance"), ("marketing", "marketing"), ("growth", "marketing"),
    ("brand", "marketing"), ("product", "product"), ("people", "hr"),
    ("human resources", "hr"), ("talent", "hr"), ("revenue", "sales"), ("sales", "sales"),
    ("commercial", "sales"), ("business", "sales"), ("customer", "customer_success"),
    ("information security", "it"), ("security", "it"), ("information", "it"),
    ("data", "data"), ("analytics", "data"), ("ai", "data"), ("medical", "medical"),
    ("nursing", "medical"), ("legal", "legal"), ("compliance", "legal"),
    ("design", "design"), ("experience", "design"), ("creative", "design"),
    ("strategy", "executive"), ("of staff", "executive"), ("scientific", "research"),
    ("science", "research"), ("research", "research"), ("communications", "media"),
    ("content", "marketing"), ("accounting", "finance"), ("investment", "finance"),
)

_DEPT_RULES = (
    ("medical", _rx(r"physician", r"doctor", r"dentist", r"dental", r"orthodont\w*", r"nurse",
                    r"nursing", r"surgeon", r"pediatric\w*", r"paediatric\w*", r"cardiolog\w*",
                    r"dermatolog\w*", r"radiolog\w*", r"oncolog\w*", r"psychiatr\w*",
                    r"therapist", r"physiotherap\w*", r"pharmac\w*", r"veterinar\w*",
                    r"optometr\w*", r"chiropract\w*", r"hygienist", r"clinical", r"clinic",
                    r"medical", r"health", r"healthcare", r"dds", r"dmd", r"rn",
                    r"internal medicine", r"family medicine", r"general practitioner")),
    ("legal", _rx(r"legal", r"counsel", r"attorney", r"lawyer", r"solicitor", r"barrister",
                  r"paralegal", r"compliance", r"law", r"litigation", r"privacy officer")),
    ("hr", _rx(r"hr", r"human resources", r"people (?:ops|operations|partner|team|lead)",
               r"head of people", r"vp,? people", r"people & culture", r"people and culture",
               r"talent", r"recruit\w*", r"hiring", r"payroll", r"benefits", r"culture")),
    ("finance", _rx(r"finance", r"financial", r"accounting", r"accountant", r"controller",
                    r"comptroller", r"treasur\w*", r"tax", r"bookkeep\w*", r"audit\w*",
                    r"fp&a", r"investor relations", r"cpa", r"actuar\w*", r"billing")),
    ("sales", _rx(r"sales", r"account executive", r"ae", r"sdr", r"bdr", r"business development",
                  r"bizdev", r"revenue", r"partnerships?", r"channel", r"commercial",
                  r"account manager", r"key account", r"inside sales", r"field sales",
                  r"sales engineer", r"pre-?sales", r"alliances")),
    ("customer_success", _rx(r"customer success", r"customer experience", r"cx",
                             r"customer support", r"support", r"customer service",
                             r"client services?", r"onboarding", r"implementation",
                             r"account management", r"client success", r"help ?desk")),
    ("marketing", _rx(r"marketing", r"marketer", r"growth", r"brand", r"content", r"seo",
                      r"sem", r"ppc", r"social media", r"demand gen\w*", r"lead gen\w*",
                      r"pr", r"public relations", r"community", r"copywriter",
                      r"product marketing", r"lifecycle", r"campaigns?", r"events?")),
    ("design", _rx(r"design\w*", r"ux", r"ui", r"user experience", r"creative",
                   r"art director", r"illustrat\w*", r"visual", r"graphic", r"motion")),
    ("product", _rx(r"product", r"pm", r"product owner", r"program manager")),
    ("data", _rx(r"data", r"analytics", r"analyst", r"machine learning", r"ml", r"ai",
                 r"artificial intelligence", r"bi", r"business intelligence",
                 r"statistic\w*", r"quant\w*")),
    ("research", _rx(r"research\w*", r"scientist", r"science", r"professor", r"lecturer",
                     r"phd", r"ph\.d\.?", r"postdoc\w*", r"post-doctoral", r"academic",
                     r"faculty", r"dean", r"teacher", r"teaching", r"educat\w*",
                     r"tutor", r"instructor", r"principal investigator", r"fellow")),
    ("it", _rx(r"it", r"information technology", r"sysadmin", r"system administrator",
               r"systems administrator", r"network", r"infosec", r"information security",
               r"cyber ?security", r"security", r"helpdesk", r"desktop support")),
    ("engineering", _rx(r"engineer\w*", r"developer", r"programmer", r"software",
                        r"devops", r"sre", r"site reliability", r"architect", r"technical",
                        r"technology", r"tech lead", r"firmware", r"front-?end", r"back-?end",
                        r"full-?stack", r"mobile", r"ios", r"android", r"qa",
                        r"quality assurance", r"test", r"infrastructure", r"platform",
                        r"hacker", r"maintainer", r"coder", r"web")),
    ("operations", _rx(r"operations", r"ops", r"logistics", r"supply chain", r"procurement",
                       r"purchasing", r"office manager", r"administrator", r"admin",
                       r"facilities", r"general manager", r"store manager", r"warehouse",
                       r"fulfil+ment", r"dispatch", r"coordinator", r"chief of staff")),
    ("consulting", _rx(r"consult\w*", r"advisor", r"adviser", r"advisory")),
    ("media", _rx(r"editor", r"journalist", r"writer", r"reporter", r"producer",
                  r"communications", r"comms", r"author", r"photographer", r"videographer")),
)
_EXECUTIVE = _rx(r"ceo", r"president", r"founder", r"co-?founder", r"owner", r"proprietor",
                 r"managing director", r"executive director", r"general partner",
                 r"managing partner", r"chair(?:man|woman|person)?", r"principal", r"partner",
                 r"board", r"cxo", r"md")


def department(title: str) -> str:
    """The department key for ``title`` ('' when nothing matches)."""
    t = _normalize(title)
    if not t:
        return ""
    low = t.lower()
    # Explicit C-level: "CTO", "Chief Marketing Officer".
    for tok in re.findall(r"\b[a-z]{3,4}\b", low):
        if tok in _CHIEF:
            return _CHIEF[tok]
    m = re.search(r"\bchief ([a-z ]+?) officer\b|\bchief (?:of )?([a-z]+)\b", low)
    if m:
        what = (m.group(1) or m.group(2) or "").strip()
        for word, dept in _CHIEF_WORDS:
            if what.startswith(word) or word == what:
                return dept
    func = _functional(low)
    if func:
        return func
    if _EXECUTIVE.search(low):
        return "executive"
    return ""


def _functional(low: str) -> str:
    for key, rx in _DEPT_RULES:
        if rx.search(low):
            return key
    return ""


def classify(title: str) -> tuple:
    """``(seniority, department)`` for ``title``; either may be ''."""
    return seniority(title), department(title)


def _normalize(title: str) -> str:
    t = re.sub(r"\s+", " ", (title or "")).strip()
    if t.lower() in _NON_TITLES:
        return ""
    return t


def seniority_at_least(level: str, floor: str) -> bool:
    """True if ``level`` is as senior as ``floor`` or more ("vp" ≥ "director")."""
    if level not in SENIORITY_RANK or floor not in SENIORITY_RANK:
        return False
    return SENIORITY_RANK[level] <= SENIORITY_RANK[floor]


def label_seniority(key: str) -> str:
    return SENIORITY_LABELS.get(key, "")


def label_department(key: str) -> str:
    return DEPARTMENT_LABELS.get(key, "")
