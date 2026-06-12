"""Network-free tests for the automation layer: dedupe, crm, templates, pipeline."""
import pytest

from openleads.models import Entity, Lead, Query


@pytest.fixture()
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENLEADS_HOME", str(tmp_path))
    from openleads.db import DB
    d = DB(path=str(tmp_path / "ol.db"))
    yield d
    d.close()


def _lead(email, tier="safe"):
    return Lead(first_name="Ada", last_name="L", email=email, organization="Acme",
                tier=tier, score=90, source="yc")


# --- dedupe ----------------------------------------------------------------
def test_partition_filters_suppressed_and_engaged(db):
    from openleads.automate import dedupe
    db.suppress("bounced@x.com", "bounced")
    db.upsert_lead({"email": "sent@x.com", "first_name": "Al"})
    db.set_status("sent@x.com", "sent")
    leads = [_lead("fresh@x.com"), _lead("bounced@x.com"), _lead("sent@x.com"),
             _lead("fresh@x.com")]  # duplicate
    fresh, skipped = dedupe.partition(db, leads)
    assert [ld.email for ld in fresh] == ["fresh@x.com"]
    assert len(skipped) == 3


def test_add_and_import_do_not_contact(db, tmp_path):
    from openleads.automate import dedupe
    assert dedupe.add_do_not_contact(db, "no@x.com") == 1
    assert db.is_suppressed("no@x.com") == "do_not_contact"
    p = tmp_path / "supp.txt"
    p.write_text("a@x.com, b@x.com\nc@x.com\n")
    assert dedupe.import_suppression(db, str(p)) == 3
    assert db.is_suppressed("b@x.com")


# --- crm -------------------------------------------------------------------
def test_crm_overview_and_rows(db):
    from openleads.automate import crm
    db.upsert_lead(_lead("a@x.com").to_dict())
    db.upsert_lead(_lead("b@x.com").to_dict())
    db.set_status("a@x.com", "sent")
    db.record_touch("a@x.com", "sent", subject="hi")
    ov = crm.overview(db)
    assert ov["total_leads"] == 2
    assert ov["sent_total"] == 1
    rows = crm.rows(db)
    assert {r["email"] for r in rows} == {"a@x.com", "b@x.com"}


def test_crm_export_csv(db, tmp_path):
    from openleads.automate import crm
    db.upsert_lead(_lead("a@x.com").to_dict())
    out = tmp_path / "crm.csv"
    n = crm.export_csv(db, str(out))
    assert n == 1
    assert "a@x.com" in out.read_text()


# --- templates -------------------------------------------------------------
def test_template_save_render_and_ab(db, tmp_path, monkeypatch):
    monkeypatch.setenv("OPENLEADS_HOME", str(tmp_path))
    from openleads.automate import templates
    templates.save("hi", ["A {first}", "B {first}"], "Hey {first} at {organization}")
    subj, body = templates.render("hi", {"first_name": "Ada", "organization": "Acme",
                                         "email": "ada@acme.io"}, sender="Sam")
    assert subj in ("A Ada", "B Ada")
    assert body == "Hey Ada at Acme"
    # deterministic A/B for a given key
    assert templates.pick_subject(["x", "y"], "ada@acme.io") == \
        templates.pick_subject(["x", "y"], "ada@acme.io")


# --- scheduler -------------------------------------------------------------
def test_cron_line():
    from openleads.automate import scheduler
    line = scheduler.cron_line(hour=8)
    assert line.startswith("0 8 * * *")
    assert "openleads" in line


# --- pipeline (with a fake source, dry-run) --------------------------------
def test_pipeline_run_dry(db, monkeypatch, tmp_path):
    monkeypatch.setenv("OPENLEADS_HOME", str(tmp_path))
    from openleads.automate import pipeline
    from openleads.cache.store import Cache
    from openleads.sources import get_registry

    class _FakeSource:
        name, kind, vertical, description = "fakep", "people", "t", "f"
        cache = None

        def search(self, query):
            yield Entity(full_name="Ada Lovelace", domain="acme.io", source="fakep")

        def info(self):
            from openleads.models import SourceInfo
            return SourceInfo(self.name, self.kind, self.description, self.vertical)

    get_registry(reload=True)["fakep"] = _FakeSource()
    # Stub the verifier so no network is touched; return a safe lead.
    import openleads.engine as eng
    from openleads.models import EmailResult
    monkeypatch.setattr(eng, "find_email",
                        lambda n, d, **kw: EmailResult(email="ada.lovelace@acme.io",
                                                       confidence="verified", score=95,
                                                       tier="safe"))
    cache = Cache(path=str(tmp_path / "c.db"))
    q = Query(source="fakep", count=1, verified_only=True)
    out = pipeline.run(q, send=True, dry_run=True, cache=cache, db=db)
    cache.close()
    assert len(out["leads"]) == 1
    assert len(out["drafts"]) == 1
    assert out["results"][0].status == "preview"
    assert db.get_lead("ada.lovelace@acme.io") is not None  # saved to CRM
