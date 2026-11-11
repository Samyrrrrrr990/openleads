"""Bring your own model: subscriptions (claude, codex CLIs), API keys, free/local endpoints."""
import json
import os

import pytest

from openleads import ai


@pytest.fixture(autouse=True)
def clean(monkeypatch, tmp_path):
    monkeypatch.setenv("OPENLEADS_HOME", str(tmp_path))
    for k in ("OPENROUTER_API_KEY", "OPENLEADS_AI_BASE_URL", "OPENLEADS_AI_API_KEY",
              "OPENLEADS_AI_MODEL", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY",
              "GOOGLE_API_KEY", "OPENLEADS_AI_PROVIDER"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(ai, "_which", lambda name: None)
    monkeypatch.setattr(ai, "_ollama_models", lambda timeout=0.4: [])


MSGS = [{"role": "system", "content": "Be brief."}, {"role": "user", "content": "Say hi."}]


class Runner:
    def __init__(self, code=0, out="", err="", write=None):
        self.code, self.out, self.err, self.write = code, out, err, write
        self.calls = []

    def __call__(self, cmd, stdin, timeout, cwd):
        self.calls.append({"cmd": cmd, "stdin": stdin, "timeout": timeout, "cwd": cwd})
        if self.write:
            path = cmd[cmd.index("--output-last-message") + 1]
            with open(path, "w", encoding="utf-8") as f:
                f.write(self.write)
        return self.code, self.out, self.err


# --- choosing a model -------------------------------------------------------- #
def test_nothing_configured_means_no_model():
    assert ai.resolve() is None and ai.available() is False


def test_auto_keeps_pre_5_4_setups(set_setting):
    set_setting("openrouter_api_key", "sk-or-x")
    m = ai.resolve()
    assert m.provider == "openrouter" and m.model == "openai/gpt-oss-120b:free"
    set_setting("ai_base_url", "http://localhost:11434/v1")
    set_setting("ai_model", "llama3.2")
    m = ai.resolve()
    assert m.provider == "custom" and m.url.endswith("/v1/chat/completions") and m.model == "llama3.2"


def test_auto_never_spends_a_subscription_or_paid_key_without_a_yes(monkeypatch):
    monkeypatch.setattr(ai, "_which", lambda name: f"/usr/local/bin/{name}")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-x")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-x")
    assert ai.resolve() is None


@pytest.mark.parametrize("provider,expect", [
    ("claude", {"provider": "claude", "binary": "/usr/local/bin/claude", "model": "sonnet"}),
    ("codex", {"provider": "codex", "binary": "/usr/local/bin/codex", "model": ""}),
])
def test_cli_providers_once_chosen(set_setting, monkeypatch, provider, expect):
    monkeypatch.setattr(ai, "_which", lambda name: f"/usr/local/bin/{name}")
    set_setting("ai_provider", provider)
    m = ai.resolve()
    assert {k: getattr(m, k) for k in expect} == expect and m.timeout >= 90


def test_chosen_cli_that_is_missing_is_none(set_setting):
    set_setting("ai_provider", "claude")
    assert ai.resolve() is None
    assert "claude" in ai.problem()


@pytest.mark.parametrize("provider,env,url,model", [
    ("anthropic", "ANTHROPIC_API_KEY", "https://api.anthropic.com/v1/messages", "claude-sonnet-5-5"),
    ("openai", "OPENAI_API_KEY", "https://api.openai.com/v1/chat/completions", "gpt-4.1-mini"),
    ("gemini", "GEMINI_API_KEY",
     "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", "gemini-2.5-flash"),
])
def test_api_key_providers(set_setting, monkeypatch, provider, env, url, model):
    monkeypatch.setenv(env, "k-123")
    set_setting("ai_provider", provider)
    m = ai.resolve()
    assert (m.provider, m.url, m.model, m.api_key) == (provider, url, model, "k-123")


def test_ai_model_setting_overrides_default(set_setting, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    set_setting("ai_provider", "anthropic")
    set_setting("ai_model", "claude-haiku-5-5")
    assert ai.resolve().model == "claude-haiku-5-5"


def test_ollama_picks_first_local_model(set_setting, monkeypatch):
    monkeypatch.setattr(ai, "_ollama_models", lambda timeout=0.4: ["qwen2.5:3b", "llama3.2"])
    set_setting("ai_provider", "ollama")
    m = ai.resolve()
    assert m.provider == "ollama" and m.model == "qwen2.5:3b" and "11434" in m.url


def test_off_turns_everything_off(set_setting):
    set_setting("openrouter_api_key", "sk-or-x")
    set_setting("ai_provider", "off")
    assert ai.resolve() is None


def test_detect_lists_what_this_machine_has(monkeypatch):
    monkeypatch.setattr(ai, "_which", lambda name: "/bin/claude" if name == "claude" else None)
    monkeypatch.setenv("OPENAI_API_KEY", "k")
    monkeypatch.setattr(ai, "_ollama_models", lambda timeout=0.4: ["llama3.2"])
    found = {d["provider"]: d for d in ai.detect()}
    assert set(found) == {"claude", "openai", "ollama"}
    assert found["claude"]["kind"] == "subscription" and found["openai"]["kind"] == "api key"
    assert found["ollama"]["kind"] == "free"
    assert [d["provider"] for d in ai.detect()][0] == "claude"      # subscriptions first


# --- talking to it ----------------------------------------------------------- #
def test_claude_cli_call_has_no_tools_and_reads_result(set_setting, monkeypatch):
    monkeypatch.setattr(ai, "_which", lambda name: "/bin/claude")
    set_setting("ai_provider", "claude")
    run = Runner(out=json.dumps({"type": "result", "is_error": False, "result": "hi there"}))
    assert ai.chat(MSGS, runner=run) == "hi there"
    c = run.calls[0]
    cmd = c["cmd"]
    assert cmd[0] == "/bin/claude" and "-p" in cmd
    assert cmd[cmd.index("--output-format") + 1] == "json"
    assert cmd[cmd.index("--tools") + 1] == ""
    assert cmd[cmd.index("--permission-mode") + 1] == "dontAsk"
    assert "--no-session-persistence" in cmd and cmd[cmd.index("--model") + 1] == "sonnet"
    assert "Be brief." in c["stdin"] and "Say hi." in c["stdin"]
    assert c["cwd"] and c["cwd"] != os.getcwd()          # never runs inside your project


def test_claude_cli_retries_without_flag_old_versions(set_setting, monkeypatch):
    monkeypatch.setattr(ai, "_which", lambda name: "/bin/claude")
    set_setting("ai_provider", "claude")
    calls = []

    def run(cmd, stdin, timeout, cwd):
        calls.append(cmd)
        if "--no-session-persistence" in cmd:
            return 1, "", "error: unknown option '--no-session-persistence'"
        return 0, json.dumps({"is_error": False, "result": "ok"}), ""
    assert ai.chat(MSGS, runner=run) == "ok" and len(calls) == 2


def test_claude_cli_error_is_an_aierror(set_setting, monkeypatch):
    monkeypatch.setattr(ai, "_which", lambda name: "/bin/claude")
    set_setting("ai_provider", "claude")
    with pytest.raises(ai.AIError, match="not logged in"):
        ai.chat(MSGS, runner=Runner(out=json.dumps({"is_error": True, "result": "not logged in"})))
    with pytest.raises(ai.AIError):
        ai.chat(MSGS, runner=Runner(code=1, err="boom"))


def test_codex_cli_reads_the_last_message_file(set_setting, monkeypatch):
    monkeypatch.setattr(ai, "_which", lambda name: "/bin/codex")
    set_setting("ai_provider", "codex")
    run = Runner(write="hello from codex\n")
    assert ai.chat(MSGS, runner=run) == "hello from codex"
    cmd = run.calls[0]["cmd"]
    assert cmd[:2] == ["/bin/codex", "exec"] and cmd[-1] == "-"
    for flag in ("--ephemeral", "--skip-git-repo-check"):
        assert flag in cmd
    assert cmd[cmd.index("-s") + 1] == "read-only"
    assert "features.plugins=false" in cmd and "--model" not in cmd


def test_anthropic_messages_api(set_setting, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant")
    set_setting("ai_provider", "anthropic")
    seen = {}

    def http(url, payload, headers, timeout):
        seen.update(url=url, payload=payload, headers=headers)
        return {"content": [{"type": "text", "text": "hello"}]}
    assert ai.chat(MSGS, http=http) == "hello"
    assert seen["headers"]["x-api-key"] == "sk-ant" and "anthropic-version" in seen["headers"]
    assert seen["payload"]["system"] == "Be brief."
    assert seen["payload"]["messages"] == [{"role": "user", "content": "Say hi."}]


def test_openai_compatible(set_setting, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-oa")
    set_setting("ai_provider", "openai")
    seen = {}

    def http(url, payload, headers, timeout):
        seen.update(payload=payload, headers=headers)
        return {"choices": [{"message": {"content": "<think>x</think>yo"}}]}
    assert ai.chat(MSGS, http=http) == "yo"
    assert seen["headers"]["Authorization"] == "Bearer sk-oa" and seen["payload"]["messages"] == MSGS


def test_complete_json_parses_fenced_json(set_setting):
    set_setting("openrouter_api_key", "k")
    out = ai.complete_json("sys", "user",
                           http=lambda *a: {"choices": [{"message": {"content":
                                                                     '```json\n{"a": 1}\n```'}}]})
    assert out == {"a": 1}


def test_no_model_raises():
    with pytest.raises(ai.AIError, match="openleads setup ai"):
        ai.chat(MSGS)
