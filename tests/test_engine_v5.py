"""v5 engine: leads carry seniority, department, phone, size and industry."""
from openleads.engine import entity_to_lead, industry_for
from openleads.models import CSV_FIELDS, EmailResult, Entity, Lead


def _res(email="jane@acme.example"):
    return EmailResult(email=email, confidence="verified", score=90, tier="safe",
                       signals={"groundtruth_exact": True})


def test_person_lead_gets_structured_fields():
    ent = Entity(full_name="Jane Doe", title="VP of Marketing", organization="Acme",
                 domain="acme.example", links={"phone": "+1 512 555 0100; +1 512 555 0101"},
                 extra={"employees": "37", "industry": "Fintech"}, source="yc")
    ld = entity_to_lead(ent, _res())
    assert (ld.seniority, ld.department) == ("vp", "marketing")
    assert ld.phone == "+15125550100"
    assert ld.company_size == "11-50"
    assert ld.industry == "Fintech"


def test_company_contact_has_no_person_fields_but_gets_industry():
    ent = Entity(full_name="", title="Dentist", organization="Acme Dental",
                 domain="acmedental.example", extra={"category": "dentist"}, source="local")
    ld = entity_to_lead(ent, _res("info@acmedental.example"))
    assert ld.seniority == "" and ld.department == ""
    assert ld.industry == "Dental"


def test_industry_for_unknown_category_is_readable():
    assert industry_for(Entity(full_name="", extra={"category": "pet_grooming"})) == "Pet grooming"
    assert industry_for(Entity(full_name="", extra={"category": "business"})) == ""


def test_csv_and_dict_carry_new_fields():
    ld = Lead(first_name="Jane", email="jane@acme.example", seniority="vp",
              department="marketing", phone="+15125550100", company_size="11-50",
              technologies=["Shopify", "Klaviyo"],
              socials={"linkedin": "https://www.linkedin.com/company/acme"},
              description="We sell widgets.")
    row = ld.to_csv_row()
    assert list(row) == CSV_FIELDS
    assert row["Technologies"] == "Shopify, Klaviyo"
    assert row["Company LinkedIn Url"].endswith("/company/acme")
    d = ld.to_dict()
    assert d["seniority"] == "vp" and d["technologies"] == ["Shopify", "Klaviyo"]
    # Round-trips through the exporters' dict → Lead coercion.
    again = Lead(**{k: v for k, v in d.items() if k in Lead.__dataclass_fields__})
    assert again.socials == ld.socials


# --- company profiles + filters inside build_leads ------------------------- #
from openleads import engine  # noqa: E402
from openleads.models import Query  # noqa: E402

PROFILE = {"domain": "acme.example", "name": "Acme", "description": "Widgets for dentists.",
           "industry": "Software", "phone": "+15125550100", "phones": ["+15125550100"],
           "socials": {"linkedin": "https://www.linkedin.com/company/acme"},
           "technologies": ["HubSpot", "WordPress"], "size": "11-50", "employees": "30",
           "address": {"city": "Austin", "country": "US"}}


def _people():
    return [
        Entity(full_name="Jane Doe", title="VP of Sales", organization="Acme",
               domain="acme.example", source="t"),
        Entity(full_name="John Roe", title="Software Engineer", organization="Acme",
               domain="acme.example", source="t"),
        Entity(full_name="Ann Poe", title="Head of Sales", organization="Beta",
               domain="beta.example", source="t"),
    ]


def _patch(monkeypatch, calls):
    monkeypatch.setattr(engine, "_entity_stream", lambda q, c, d, p: (iter(_people()), "t"))
    monkeypatch.setattr(engine, "find_email", lambda name, domain, **kw: EmailResult(
        email=name.split()[0].lower() + "@" + domain, tier="safe", score=90,
        signals={"groundtruth_exact": True}))

    def fake_profile(domain, cache=None, timeout=5):
        calls.append(domain)
        return dict(PROFILE, domain=domain)
    monkeypatch.setattr(engine, "fetch_profile", fake_profile)


def test_profiles_fold_in_once_per_domain(monkeypatch):
    calls = []
    _patch(monkeypatch, calls)
    leads = engine.build_leads(Query(count=10, budget=0))
    assert len(leads) == 3
    assert sorted(calls) == ["acme.example", "beta.example"]
    jane = leads[0]
    assert jane.technologies == ["HubSpot", "WordPress"]
    assert jane.socials["linkedin"].endswith("/company/acme")
    assert jane.phone == "+15125550100" and jane.city == "Austin"
    assert jane.industry == "Software" and jane.company_size == "11-50"


def test_profiles_can_be_turned_off(monkeypatch):
    calls = []
    _patch(monkeypatch, calls)
    leads = engine.build_leads(Query(count=10, budget=0, company_profile=False))
    assert calls == [] and leads[0].technologies == []


def test_seniority_and_department_filters(monkeypatch):
    _patch(monkeypatch, [])
    leads = engine.build_leads(Query(count=10, budget=0, seniority=["vp", "head"],
                                     department=["sales"]))
    assert [ld.first_name for ld in leads] == ["Jane", "Ann"]


def test_apply_profile_never_overwrites():
    ld = Lead(first_name="Jane", phone="+442079460958", industry="Fintech", city="London")
    engine.apply_profile(ld, PROFILE)
    assert ld.phone == "+442079460958" and ld.industry == "Fintech" and ld.city == "London"
    assert engine.apply_profile(Lead(), {"error": "homepage unreachable"}).technologies == []
