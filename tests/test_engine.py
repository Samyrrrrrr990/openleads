"""Tests for writers and the engine pipeline (network-free, via a fake source)."""
import json

from openleads import writers
from openleads.engine import build_leads, entity_to_lead
from openleads.models import CSV_FIELDS, EmailResult, Entity, Lead, Query
from openleads.sources import get_registry


def _lead(**kw):
    base = dict(first_name="Ada", last_name="Lovelace", email="ada@acme.io",
                title="Founder", organization="Acme", confidence="verified",
                score=96, source="yc", vertical="startup founders")
    base.update(kw)
    return Lead(**base)


# --- writers ---------------------------------------------------------------
def test_write_csv_schema(tmp_path):
    p = tmp_path / "out.csv"
    writers.write_csv([_lead()], str(p))
    text = p.read_text()
    header = text.splitlines()[0]
    assert header == ",".join(CSV_FIELDS)
    assert "ada@acme.io" in text
    assert "Email Score" in header and "Source" in header


def test_write_json_roundtrip(tmp_path):
    p = tmp_path / "out.json"
    writers.write_json([_lead(), _lead(email="grace@x.com")], str(p))
    data = json.loads(p.read_text())
    assert len(data) == 2
    assert data[0]["email"] == "ada@acme.io"
    assert data[0]["score"] == 96


def test_write_ndjson(tmp_path):
    p = tmp_path / "out.ndjson"
    writers.write_ndjson([_lead(), _lead()], str(p))
    lines = [ln for ln in p.read_text().splitlines() if ln.strip()]
    assert len(lines) == 2
    assert json.loads(lines[0])["email"] == "ada@acme.io"


def test_write_dispatch_unknown_format():
    try:
        writers.write([_lead()], fmt="xml")
    except ValueError as e:
        assert "xml" in str(e)
    else:
        raise AssertionError("expected ValueError")


# --- entity_to_lead --------------------------------------------------------
def test_entity_to_lead_maps_fields():
    ent = Entity(full_name="Ada Lovelace", title="Founder", organization="Acme",
                 domain="acme.io", website="https://acme.io",
                 links={"linkedin": "https://li/ada"},
                 extra={"industry": "AI", "employees": "5", "city": "SF",
                        "country": "USA"}, source="yc")
    res = EmailResult(email="ada@acme.io", confidence="verified", score=96)
    lead = entity_to_lead(ent, res)
    assert (lead.first_name, lead.last_name) == ("Ada", "Lovelace")
    assert lead.linkedin_url == "https://li/ada"
    assert lead.city == "SF" and lead.industry == "AI"


# --- engine pipeline with a fake source ------------------------------------
class _FakeSource:
    name = "fake"
    kind = "people"
    vertical = "test"
    description = "fake"

    def __init__(self, entities):
        self._entities = entities
        self.cache = None

    def search(self, query):
        yield from self._entities

    def info(self):
        from openleads.models import SourceInfo
        return SourceInfo(self.name, self.kind, self.description, self.vertical)


def test_build_leads_domainless_records_kept(monkeypatch):
    # A people source with no domains: records should still come back (verified_only off).
    ents = [Entity(full_name=f"Doc {i}", organization="Clinic", source="fake")
            for i in range(3)]
    fake = _FakeSource(ents)
    get_registry(reload=True)["fake"] = fake

    leads = build_leads(Query(source="fake", count=2))
    assert len(leads) == 2
    assert all(ld.email == "" and ld.confidence == "none" for ld in leads)


def test_build_leads_verified_only_filters(monkeypatch):
    ents = [Entity(full_name="Ada Lovelace", domain="acme.io", source="fake")]
    fake = _FakeSource(ents)
    get_registry(reload=True)["fake"] = fake

    # Stub find_email so no network is touched.
    import openleads.engine as eng
    monkeypatch.setattr(eng, "find_email",
                        lambda n, d, **kw: EmailResult(email="ada@acme.io",
                                                       confidence="pattern_guess",
                                                       score=40, tier="risky"))
    leads = build_leads(Query(source="fake", count=5, verified_only=True))
    assert leads == []  # only 'safe'-tier survives verified_only; risky is dropped


def test_build_leads_concurrent_preserves_order(monkeypatch):
    ents = [Entity(full_name=f"P{i}", domain=f"d{i}.io", source="fake") for i in range(12)]
    get_registry(reload=True)["fake"] = _FakeSource(ents)

    import openleads.engine as eng
    monkeypatch.setattr(eng, "find_email",
                        lambda n, d, **kw: EmailResult(email=f"{n}@{d}", confidence="verified",
                                                       score=95, tier="safe"))
    leads = build_leads(Query(source="fake", count=10))
    # despite the thread pool, output order matches input order
    assert [ld.email for ld in leads] == [f"P{i}@d{i}.io" for i in range(10)]


def test_build_leads_futility_exit_emits_phase():
    # a big domain-less source + verified_only → no safe leads → bail with a message
    ents = [Entity(full_name=f"X{i}", organization="Org", source="fake") for i in range(300)]
    get_registry(reload=True)["fake"] = _FakeSource(ents)
    phases = []
    leads = build_leads(Query(source="fake", count=10, verified_only=True),
                        on_progress=lambda k, p: phases.append(p) if k == "phase" else None)
    assert leads == []
    assert any("no email domain" in str(p) for p in phases)
