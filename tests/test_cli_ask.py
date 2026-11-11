"""`openleads "..."`: requests route to ask, typos get a suggestion, commands are unchanged."""
import io
import json

import pytest

from openleads import ask, cli, cli_ask


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


@pytest.mark.parametrize("argv,match", [(["fnd", "dentists in Austin"], "find"),
                                        (["peple"], "people"), (["todya", "--json"], "today")])
def test_typo_with_arguments_is_still_a_typo(capsys, stub_run_plan, argv, match):
    assert cli.main(argv) == 2
    assert f"Did you mean `openleads {match}`" in capsys.readouterr().err and stub_run_plan == []


@pytest.mark.parametrize("words", [["dentists", "in", "Austin"], ["email", "10", "founders"],
                                   ["tag", "everyone", "from", "Stripe"]])
def test_plain_requests_are_not_typos(capsys, monkeypatch, stub_run_plan, words):
    monkeypatch.setattr(cli, "cmd_find", lambda args: 0)
    monkeypatch.setattr("sys.stdin", io.StringIO(""))
    cli.main(words)
    assert "Did you mean" not in capsys.readouterr().err


def test_plan_says_which_model_read_it(monkeypatch, capsys):
    import json as _json

    from openleads import ai
    monkeypatch.setattr(ai, "resolve", lambda overrides=None: ai.Model("codex", "gpt-5"))
    monkeypatch.setattr(ai, "chat", lambda *a, **k: _json.dumps(
        {"kind": "campaign", "audience": "rust developers in Berlin", "count": 30,
         "goal": "our hiring tool"}))
    monkeypatch.setattr(cli_ask, "_interactive", lambda: False)
    assert cli_ask.cmd_ask(["get", "me", "thirty", "berlin", "rustaceans", "re", "hiring"]) == 0
    out = capsys.readouterr().out
    assert "read by codex:gpt-5" in out and "rust developers in Berlin" in out


def test_a_question_gets_an_answer_not_a_search(monkeypatch, capsys):
    monkeypatch.setattr(ask, "question", lambda text, db: "Two people replied this week.")
    monkeypatch.setattr(ask, "make_plan", lambda *a, **k: pytest.fail("planned a question"))
    assert cli_ask.cmd_ask(["who", "replied", "this", "week?"]) == 0
    assert "Two people replied this week." in capsys.readouterr().out


def test_question_json(monkeypatch, capsys):
    monkeypatch.setattr(ask, "question", lambda text, db: "None yet.")
    assert cli_ask.cmd_ask(["who", "replied?", "--json"]) == 0
    assert json.loads(capsys.readouterr().out) == {"answer": "None yet."}
