"""CSV import with header auto-mapping."""
import pytest

from openleads.db import DB
from openleads.workspace import importer, lists, notes, people, tags

APOLLO = ("First Name,Last Name,Title,Company Name for Emails,Email,Person Linkedin Url,"
          "City,State,Country,# Employees,Industry,Work Direct Phone\n"
          "Jane,Doe,VP of Sales,Acme,JANE@acme.example,https://linkedin.com/in/jane,Austin,TX,"
          "United States,37,Software,+1 512 555 0100\n"
          "Bob,,Engineer,Acme,,,,,,,,\n")
HUBSPOT = ("First Name;Last Name;Email;Job Title;Company Name;Phone Number;Lifecycle Stage;Tags\n"
           "Ann;Lee;ann@beta.example;Head of Growth;Beta;;customer;vip|q4\n")
LINKEDIN = ("First Name,Last Name,Email Address,Company,Position,Connected On\n"
            "Nia,Kay,nia@gamma.example,Gamma,Director of Ops,01 Jan 2026\n")


def test_detect_mapping_for_common_exports():
    h, _ = importer.parse_csv(APOLLO)
    m = importer.detect_mapping(h)
    assert m["Email"] == "email" and m["Company Name for Emails"] == "organization"
    assert m["Person Linkedin Url"] == "linkedin_url" and m["# Employees"] == "employees"
    assert m["Work Direct Phone"] == "phone"
    h, _ = importer.parse_csv(HUBSPOT)
    m = importer.detect_mapping(h)
    assert m["Job Title"] == "title" and m["Lifecycle Stage"] == "stage" and m["Tags"] == "tags"
    h, _ = importer.parse_csv(LINKEDIN)
    m = importer.detect_mapping(h)
    assert m["Email Address"] == "email" and m["Position"] == "title"
    assert "Connected On" not in m


def test_preview_counts_and_samples():
    p = importer.preview(APOLLO)
    assert p["total"] == 2 and p["with_email"] == 1 and p["without_email"] == 1
    assert p["sample"][0]["email"] == "jane@acme.example"
    assert p["sample"][0]["first_name"] == "Jane"
    assert p["raw"][0]["Email"] == "JANE@acme.example"          # raw = as uploaded


@pytest.fixture
def db(tmp_path):
    d = DB(tmp_path / "w.db")
    yield d
    d.close()


def test_import_creates_tags_lists_stage_notes(db):
    res = importer.import_rows(db, APOLLO, list_name="Imported", tags=["apollo"])
    assert (res["created"], res["updated"], res["no_email"]) == (1, 0, 1)
    jane = people.get(db, "jane@acme.example")
    assert jane["title"] == "VP of Sales" and jane["seniority"] == "vp"
    assert jane["phone"] == "+15125550100" and jane["company_size"] == "11-50"
    assert jane["tier"] == "" and jane["source"] == "import" and jane["fit_score"] > 0
    assert tags.for_contact(db, "jane@acme.example") == ["apollo"]
    assert lists.by_name(db, "Imported")["count"] == 1
    res = importer.import_rows(db, HUBSPOT.replace(";;", ";;"))
    ann = people.get(db, "ann@beta.example")
    assert ann["stage"] == "customer" and tags.for_contact(db, "ann@beta.example") == ["q4", "vip"]


def test_import_merges_without_blanking(db):
    db.upsert_lead({"email": "jane@acme.example", "first_name": "Jane", "title": "VP of Sales",
                    "tier": "safe", "phone": "+15125550100", "signals": {"groundtruth_exact": True}})
    res = importer.import_rows(db, "email,title,phone\njane@acme.example,CRO,\n")
    assert res["updated"] == 1
    row = people.get(db, "jane@acme.example")
    assert row["title"] == "CRO" and row["tier"] == "safe" and row["phone"] == "+15125550100"
    assert row["evidence"] == "found"
    res = importer.import_rows(db, "email\njane@acme.example\n", update_existing=False)
    assert res["skipped"][0]["reason"] == "already in CRM"


def test_bad_emails_notes_and_stage_words(db):
    res = importer.import_rows(db, "email,notes,status\nnot-an-email,,\nx@y.example,Met at a "
                                   "conference,Bad data\n")
    assert res["skipped"][0]["reason"] == "not a valid email"
    assert notes.for_ref(db, "contact", "x@y.example")[0]["body"] == "Met at a conference"
    assert people.get(db, "x@y.example")["stage"] == "bad_data"
    assert importer.stage_from_text("Marketing Qualified") == ""
    assert importer.stage_from_text("MQL") == "interested"
    assert importer.parse_csv("") == ([], [])


def test_map_row_websites():
    m = {"Website": "website", "Email": "email"}
    assert importer.map_row({"Website": "web.example/about", "Email": "a@b.example"},
                            m)["website"] == "https://web.example"
    assert importer.map_row({"Website": "www.acme.example"}, m)["website"] == "https://acme.example"
    assert importer.map_row({"Website": "n/a"}, m)["website"] == ""


def test_preview_lists_rows_that_need_an_email():
    text = ("Name,Company,Website,Email\n"
            "Ann Lee,Beta,www.beta.example/about,\n"
            "Bob Roe,Gamma,,\n"
            "Cy,,,\n"
            "Dee Fox,Delta,delta.example,dee@delta.example\n")
    p = importer.preview(text)
    assert p["needs_email"] == [{"name": "Ann Lee", "company": "Beta", "domain": "beta.example"},
                                {"name": "Bob Roe", "company": "Gamma", "domain": ""}]
