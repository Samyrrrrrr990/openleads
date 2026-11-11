"""`openleads setup ai`: pick the model OpenLeads thinks with, test it, keep it."""
import json

import pytest

from openleads import ai, cli_ai, settings
from openleads.cli import main


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    for k in ("OPENROUTER_API_KEY", "OPENLEADS_AI_BASE_URL", "OPENLEADS_AI_MODEL",
              "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY",
              "OPENLEADS_AI_PROVIDER"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(ai, "_which", lambda name: None)
    monkeypatch.setattr(ai, "_ollama_models", lambda timeout=0.4: [])
    yield
    for k in ("ai_provider", "ai_model", "ai_provider_model", "anthropic_api_key",
              "openai_api_key", "openrouter_api_key"):
        settings.unset(k)


def claude_ok(monkeypatch, answer="ready"):
    monkeypatch.setattr(ai, "_which", lambda name: "/bin/claude" if name == "claude" else None)
    calls = []

    def run(cmd, stdin, timeout, cwd):
        calls.append(cmd)
        return 0, json.dumps({"is_error": False, "result": answer}), ""
    monkeypatch.setattr(ai, "_run", run)
    return calls


def test_use_claude_tests_it_and_keeps_it(monkeypatch, capsys):
    calls = claude_ok(monkeypatch)
    assert main(["setup", "ai", "--use", "claude"], _tips=False) == 0
    out = capsys.readouterr().out
    assert settings.get("ai_provider") == "claude" and len(calls) == 1
    assert "Connected" in out and "claude" in out.lower()


def test_failed_test_call_keeps_the_previous_choice(monkeypatch, capsys):
    monkeypatch.setattr(ai, "_which", lambda name: "/bin/claude")
    monkeypatch.setattr(ai, "_run", lambda *a: (1, "", "Please run /login"))
    settings.set("ai_provider", "off")
    assert main(["setup", "ai", "--use", "claude"], _tips=False) == 1
    err = capsys.readouterr().err
    assert settings.get("ai_provider") == "off" and "login" in err


def test_use_a_cli_that_is_not_installed(capsys):
    assert main(["setup", "ai", "--use", "codex"], _tips=False) == 1
    assert "codex" in capsys.readouterr().err and settings.get("ai_provider") in (None, "", "auto")


def test_api_key_provider_needs_the_key_in_the_environment_when_not_interactive(capsys):
    assert main(["setup", "ai", "--use", "anthropic"], _tips=False) == 1
    assert "ANTHROPIC_API_KEY" in capsys.readouterr().err


def test_api_key_from_environment(monkeypatch, capsys):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant")
    monkeypatch.setattr(ai, "_post", lambda *a: {"content": [{"type": "text", "text": "ready"}]})
    assert main(["setup", "ai", "--use", "anthropic", "--model", "claude-haiku-5-5"],
                _tips=False) == 0
    assert settings.get("ai_provider") == "anthropic"
    assert settings.get("ai_provider_model") == "claude-haiku-5-5"


def test_off_needs_no_test(capsys):
    assert main(["setup", "ai", "--use", "off"], _tips=False) == 0
    assert settings.get("ai_provider") == "off"
    assert "rules" in capsys.readouterr().out.lower()


def test_unknown_provider(capsys):
    assert main(["setup", "ai", "--use", "skynet"], _tips=False) == 2
    assert "claude" in capsys.readouterr().err       # lists the choices


def test_no_input_lists_what_this_machine_has(monkeypatch, capsys):
    claude_ok(monkeypatch)
    monkeypatch.setattr(cli_ai, "_interactive", lambda: False)
    assert main(["setup", "ai"], _tips=False) == 0
    out = capsys.readouterr().out
    assert "claude" in out and "--use claude" in out
    assert settings.get("ai_provider") in (None, "", "auto")      # nothing chosen for you


def test_interactive_pick_by_number(monkeypatch, capsys):
    claude_ok(monkeypatch)
    monkeypatch.setattr(cli_ai, "_interactive", lambda: True)
    monkeypatch.setattr("builtins.input", lambda prompt="": "1")
    assert main(["setup", "ai"], _tips=False) == 0
    assert settings.get("ai_provider") == "claude"


def test_interactive_enter_keeps_what_you_have(monkeypatch, capsys):
    claude_ok(monkeypatch)
    monkeypatch.setattr(cli_ai, "_interactive", lambda: True)
    monkeypatch.setattr("builtins.input", lambda prompt="": "")
    assert main(["setup", "ai"], _tips=False) == 0
    assert settings.get("ai_provider") in (None, "", "auto")


def test_status_shows_the_current_model(monkeypatch, capsys):
    claude_ok(monkeypatch)
    settings.set("ai_provider", "claude")
    monkeypatch.setattr(cli_ai, "_interactive", lambda: False)
    assert main(["setup", "ai"], _tips=False) == 0
    assert "Using: Claude" in capsys.readouterr().out


def test_switching_provider_clears_the_old_model(monkeypatch, capsys):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-oa")
    seen = []
    monkeypatch.setattr(ai, "_post", lambda url, payload, *a: seen.append(payload.get("model"))
                        or ({"content": [{"type": "text", "text": "ready"}]} if "anthropic" in url
                            else {"choices": [{"message": {"content": "ready"}}]}))
    assert main(["setup", "ai", "--use", "anthropic", "--model", "claude-haiku-5-5"],
                _tips=False) == 0
    assert main(["setup", "ai", "--use", "openai"], _tips=False) == 0
    assert seen[-1] == "gpt-4.1-mini" and not settings.get("ai_provider_model")
