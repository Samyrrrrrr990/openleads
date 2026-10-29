"""CLI: grouped help, clean JSON on stdout, --quiet/--explain/--report, short-result report."""
import json

import pytest

from openleads import cli, engine
from openleads.models import EmailResult, Entity
from openleads.sources import get_registry


class _Src:
    name, kind, vertical, description = "clifake", "people", "t", "t"
    cache = None

    def search(self, q):
        yield Entity(full_name="Ada Lovelace", organization="Acme", domain="acme.example")
        yield Entity(full_name="Grace Hopper", organization="Beta", domain="beta.example")


@pytest.fixture(autouse=True)
def _offline(monkeypatch):
    monkeypatch.setattr("openleads.emails.netcheck.port25_open", lambda *a, **k: False)
    monkeypatch.setattr("openleads.discover.geo._throttle", lambda: None)


@pytest.fixture()
def fake_source(monkeypatch):
    get_registry(reload=True)["clifake"] = _Src()
    monkeypatch.setattr(engine, "find_email", lambda name, domain, **kw: EmailResult(
        email=f"{name.split()[0].lower()}@{domain}", tier="safe", score=95,
        signals={"groundtruth_exact": True}))


ARGS = ["find", "anything", "-s", "clifake", "--no-cache", "--budget", "0", "--no-company"]


def test_json_goes_to_stdout_and_ui_to_stderr(fake_source, capsys):
    assert cli.main(ARGS + ["--format", "json"]) == 0
    out, err = capsys.readouterr()
    data = json.loads(out)                       # nothing but JSON on stdout
    assert [d["email"] for d in data] == ["ada@acme.example", "grace@beta.example"]
    assert "openleads" in err and "wrote 2 leads" in err


def test_ndjson_and_jsonl_alias(fake_source, capsys):
    assert cli.main(ARGS + ["--format", "jsonl"]) == 0
    lines = capsys.readouterr().out.splitlines()
    assert [json.loads(ln)["email"] for ln in lines] == ["ada@acme.example",
                                                        "grace@beta.example"]


def test_quiet_prints_no_progress(fake_source, capsys):
    assert cli.main(ARGS + ["--format", "json", "-q", "-n", "2"]) == 0
    out, err = capsys.readouterr()
    assert json.loads(out) and err == ""
    # A short result still explains itself on stderr, even with -q.
    assert cli.main(ARGS + ["--format", "json", "-q", "-n", "5"]) == 0
    out, err = capsys.readouterr()
    assert "2/5 leads" in err and "clifake" in err


def test_csv_file_keeps_ui_on_stdout(fake_source, capsys, tmp_path):
    path = tmp_path / "leads.csv"
    assert cli.main(ARGS + ["-o", str(path)]) == 0
    assert "wrote 2 leads" in capsys.readouterr().out
    assert path.read_text(encoding="utf-8").splitlines()[0].endswith("Contact Type")


def test_explain_and_report_file(fake_source, capsys, tmp_path):
    rep_path = tmp_path / "report.json"
    assert cli.main(ARGS + ["--format", "json", "--explain", "--report", str(rep_path)]) == 0
    out, err = capsys.readouterr()
    json.loads(out)
    assert "query" in err and "clifake" in err and "pinned with --source" in err
    assert "2/20 leads" in err                   # the report, printed by --explain
    rep = json.loads(rep_path.read_text(encoding="utf-8"))
    assert rep["sources"]["clifake"]["status"] == "ok" and rep["leads"] == 2


def test_empty_result_explains_itself(capsys):
    # Network is refused in tests: the gazetteer places Austin offline, then
    # Overpass and Nominatim both fail → local reports "failed" with the reason.
    code = cli.main(["find", "dentists in Austin", "--format", "json", "--no-cache",
                     "--budget", "0", "-q"])
    out, err = capsys.readouterr()
    assert code == 1
    assert json.loads(out) == []                 # pipes still get valid JSON
    assert "local" in err and "failed" in err
    assert "OpenStreetMap is busy" in err        # a hint, not just a status
    assert "No leads produced" in err


def test_help_lists_every_command_by_group():
    parser = cli.build_parser()
    text = parser.format_help()
    reg = parser._registrar
    names = [n for n in reg.choices if n not in reg.aliases]
    assert len(names) >= 35
    missing = [n for n in names if f"  {n} " not in text]
    assert missing == []
    for group in ("find:", "outreach:", "automate:", "workspace:", "setup:", "legacy:",
                  "quick start:"):
        assert group in text
    assert "{find," not in text                  # no flat alphabetical choice list


def test_send_reports_bad_queries_cleanly(capsys):
    assert cli.main(["send", "x", "-s", "nosuchsource"]) == 2
    assert "unknown source" in capsys.readouterr().err


def test_company_format_json_alias(monkeypatch, capsys):
    monkeypatch.setattr("openleads.insights.company.fetch_profile",
                        lambda domain, cache=None, refresh=False: {"domain": domain,
                                                                   "name": "Acme"})
    monkeypatch.setattr("openleads.discover.people.find_people",
                        lambda domain, cache=None, limit=10: [])
    assert cli.main(["company", "acme.example", "--format", "json", "--no-cache"]) == 0
    assert json.loads(capsys.readouterr().out)["profile"]["name"] == "Acme"


def test_verify_json(monkeypatch, capsys):
    from openleads.emails import resolve
    monkeypatch.setattr(resolve, "_mx_lookup", lambda d, c: {"hosts": [], "status": "nxdomain"})
    assert cli.main(["verify", "ada@gone.example", "--json"]) == 0
    data = json.loads(capsys.readouterr().out)
    assert data[0]["email"] == "ada@gone.example" and data[0]["tier"] == "bad"
