"""`openleads "..."`: requests route to ask, typos get a suggestion, commands are unchanged."""
import io
import json

import pytest

from openleads import ask, cli


@pytest.fixture(autouse=True)
def home(monkeypatch, tmp_path):
    monkeypatch.setenv("OPENLEADS_HOME", str(tmp_path))


@pytest.fixture
def stub_run_plan(monkeypatch):
    calls = []

    def run(plan, live=False, db=None, emit=None):
        calls.append(plan)
        return {"ok": True, "leads": 10, "verified": 10, "drafts_waiting": 10, "sent": 0,
                "workflow": "", "message": ""}
    monkeypatch.setattr(ask, "run_plan", run)
    return calls


def test_typo_suggests_command(capsys):
    assert cli.main(["fnd"]) == 2
    assert "Did you mean `openleads find`" in capsys.readouterr().err


def test_request_needing_confirm_non_tty_prints_and_exits(capsys, monkeypatch, stub_run_plan):
    monkeypatch.setattr("sys.stdin", io.StringIO(""))
    assert cli.main(["email 10 fintech founders about our tool"]) == 0
    out = capsys.readouterr().out
    assert "Plan" in out and "1." in out and "Re-run with --yes" in out and stub_run_plan == []


def test_unquoted_words_are_one_request(capsys, monkeypatch, stub_run_plan):
    monkeypatch.setattr("sys.stdin", io.StringIO(""))
    assert cli.main(["email", "10", "fintech", "founders", "about", "our", "tool", "--yes"]) == 0
    assert stub_run_plan[0].text == "email 10 fintech founders about our tool"


def test_yes_runs_and_prints_answer(capsys, stub_run_plan):
    assert cli.main(["email 10 fintech founders about our tool", "--yes"]) == 0
    assert "drafts" in capsys.readouterr().out and len(stub_run_plan) == 1


def test_json_prints_plan_and_result(capsys, stub_run_plan):
    assert cli.main(["email 10 fintech founders about our tool", "--yes", "--json"]) == 0
    data = json.loads(capsys.readouterr().out)
    assert data["plan"]["kind"] == "workflow" and data["result"]["leads"] == 10


def test_unsupported_prints_the_command(capsys, stub_run_plan):
    assert cli.main(["tag everyone from Stripe as hot"]) == 2
    assert "openleads people tag" in capsys.readouterr().out and stub_run_plan == []


def test_find_request_uses_find_output(capsys, monkeypatch):
    seen = {}
    monkeypatch.setattr(cli, "cmd_find", lambda args: seen.setdefault("q", args.query) and 0)
    assert cli.main(["dentists in Austin"]) == 0
    assert " ".join(seen["q"]) == "dentists in Austin"


def test_known_commands_unchanged(capsys):
    assert cli.main(["today", "--json"]) == 0
    assert "counts" in json.loads(capsys.readouterr().out)
