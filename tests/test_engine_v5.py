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
