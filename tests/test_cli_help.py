"""About ten visible commands; everything else still works and has a home."""
import argparse
import json

import pytest

from openleads import cli


@pytest.fixture(autouse=True)
def home(monkeypatch, tmp_path):
    monkeypatch.setenv("OPENLEADS_HOME", str(tmp_path))
    return tmp_path


@pytest.fixture
def tty_stderr(monkeypatch):
    monkeypatch.setattr(cli, "_stderr_tty", lambda: True)


def test_top_help_lists_about_ten_commands(capsys):
    with pytest.raises(SystemExit):
        cli.main(["--help"])
    out = capsys.readouterr().out
    for cmd in ("today", "find", "verify", "write", "send", "people", "workflow", "web", "setup",
                "mcp"):
        assert f"\n  {cmd} " in out
    for hidden in ("drip", "recipe", "crm", "campaign", "dedupe"):
        assert f"\n  {hidden} " not in out
    assert "openleads help all" in out
    assert 'openleads "find 30 rust devs in Berlin and email them"' in out
    assert "(also: company, enrich, sources)" in out


def test_help_all_lists_everything(capsys):
    assert cli.main(["help", "all"]) == 0
    out = capsys.readouterr().out
    assert all(f"  {c} " in out for c in ("drip", "recipe", "crm", "campaign"))


def test_help_command_is_command_help(capsys):
    with pytest.raises(SystemExit):
        cli.main(["help", "today"])
    assert "--no-input" in capsys.readouterr().out


def test_every_registered_command_still_parses():
    p = cli.build_parser()
    for name in p._registrar.choices:
        parsed = None
        for extra in ([], ["x.example"], ["csv"]):   # some need an argument: company, export
            try:
                parsed = p.parse_known_args([name, *extra])[0]
                break
            except SystemExit:
                continue
        assert parsed is not None and parsed.command == name, name


def test_every_hidden_command_has_a_home():
    p = cli.build_parser()
    visible = {c for _, names in cli.VISIBLE for c in names}
    for name in set(p._registrar.choices) - p._registrar.aliases:
        assert name in visible or name in cli.HOME_OF or name == "help", name


def test_setup_dispatches(monkeypatch):
    seen = []
    monkeypatch.setattr(cli, "cmd_doctor", lambda a: seen.append("doctor") or 0)
    assert cli.main(["setup", "doctor"]) == 0 and seen == ["doctor"]


def test_setup_alone_runs_init(monkeypatch):
    seen = []
    monkeypatch.setattr(cli, "cmd_init", lambda a: seen.append("init") or 0)
    assert cli.main(["setup"]) == 0 and seen == ["init"]


def test_setup_rejects_unknown_action(capsys):
    assert cli.main(["setup", "dance"]) == 2
    assert "config, doctor or cache" in capsys.readouterr().err


def test_web_demo_runs_the_demo(monkeypatch):
    from openleads import cli_workspace
    seen = []
    monkeypatch.setattr(cli_workspace, "cmd_demo", lambda a: seen.append(a) or 0)
    assert cli.main(["web", "--demo", "--no-open"]) == 0
    assert isinstance(seen[0], argparse.Namespace) and seen[0].no_open is True


def test_tip_once_only_on_tty(capsys, tty_stderr, monkeypatch, home):
    monkeypatch.setattr(cli, "cmd_runs", lambda a: 0)
    cli.main(["runs"])
    first = capsys.readouterr().err
    cli.main(["runs"])
    second = capsys.readouterr().err
    assert "now lives under `openleads workflow`" in first and second == ""
    assert "runs" in json.loads((home / "tips.json").read_text())


def test_no_tip_without_tty(capsys, monkeypatch):
    monkeypatch.setattr(cli, "cmd_runs", lambda a: 0)
    cli.main(["runs"])
    assert capsys.readouterr().err == ""
