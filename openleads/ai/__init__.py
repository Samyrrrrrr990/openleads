"""
Bring your own model.

OpenLeads works without any model: rules plan your requests, write your emails and
sort your replies. Connect one and the same steps get better. Three ways in:

* **A subscription you already pay for**: Claude (the ``claude`` CLI) or ChatGPT
  (the ``codex`` CLI). OpenLeads runs them the way T3 Code's text generation does:
  one prompt on stdin, no tools, no file access, nothing saved to their history,
  from an empty temporary folder. Logging in stays with the CLI.
* **An API key**: Anthropic (Messages API), OpenAI, or Google Gemini.
* **Free or local**: OpenRouter (free models), Ollama, or any OpenAI-compatible URL.

``ai_provider=auto`` (the default) only uses what OpenLeads was already set up with
(a custom endpoint or an OpenRouter key). A subscription or a paid key is used only
after you choose it (``openleads setup ai``), so an upgrade never quietly spends
your quota or your money.

Everything here is standard library: subprocess for the CLIs, urllib for HTTP.
Callers catch :class:`AIError` and fall back to the rules, so a model can make a
step better but never break it.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import urllib.request
from dataclasses import dataclass

PROVIDERS = ("claude", "codex", "anthropic", "openai", "gemini", "openrouter", "ollama",
             "custom")
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
OPENAI_URL = "https://api.openai.com/v1/chat/completions"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
OLLAMA_URL = "http://127.0.0.1:11434"
DEFAULT_MODEL = {"claude": "sonnet", "codex": "", "anthropic": "claude-sonnet-5-5",
                 "openai": "gpt-4.1-mini", "gemini": "gemini-2.5-flash"}
LABEL = {"claude": "Claude (your subscription, via the claude CLI)",
         "codex": "ChatGPT (your subscription, via the codex CLI)",
         "anthropic": "Anthropic API", "openai": "OpenAI API", "gemini": "Google Gemini API",
         "openrouter": "OpenRouter", "ollama": "Ollama (on this computer)",
         "custom": "Your endpoint"}
KEY_SETTING = {"anthropic": "anthropic_api_key", "openai": "openai_api_key",
               "gemini": "gemini_api_key", "openrouter": "openrouter_api_key"}
CLI_TIMEOUT = 90.0


class AIError(Exception):
    """The model couldn't answer; the message says why. Callers fall back to rules."""


@dataclass
class Model:
    provider: str
    model: str = ""
    url: str = ""
    api_key: str = ""
    binary: str = ""
    timeout: float = 20.0

    @property
    def label(self) -> str:
        name = LABEL.get(self.provider, self.provider)
        return f"{name}: {self.model}" if self.model else name

    def to_dict(self) -> dict:
        return {"provider": self.provider, "model": self.model, "label": self.label,
                "url": self.url if self.provider in ("custom", "ollama") else ""}


# --- what's here -------------------------------------------------------------- #
def _which(name: str) -> str | None:
    return shutil.which(name)


def _ollama_models(timeout: float = 0.4) -> list:
    """Models an Ollama server on this computer has pulled ([] if none is running)."""
    try:
        with urllib.request.urlopen(f"{OLLAMA_URL}/api/tags", timeout=timeout) as r:
            data = json.load(r)
        return [m.get("name") for m in data.get("models") or [] if m.get("name")]
    except Exception:       # noqa: BLE001 — not running, refused, garbage: no Ollama
        return []


def _setting(key: str) -> str:
    from openleads import settings
    return str(settings.get(key) or "").strip()


def _timeout() -> float:
    try:
        return max(3.0, min(float(_setting("ai_timeout") or 20), 300.0))
    except ValueError:
        return 20.0


def endpoint(base_url: str) -> str:
    base = (base_url or "").strip().rstrip("/")
    if not base:
        return OPENROUTER_URL
    return base if base.endswith("/chat/completions") else base + "/chat/completions"


def detect(probe: bool = True) -> list:
    """Every model this machine could use, subscriptions first, then keys, then free."""
    out = []
    for name in ("claude", "codex"):
        path = _which(name)
        if path:
            out.append({"provider": name, "kind": "subscription", "label": LABEL[name],
                        "detail": path})
    for name in ("anthropic", "openai", "gemini"):
        if _setting(KEY_SETTING[name]):
            out.append({"provider": name, "kind": "api key", "label": LABEL[name], "detail": ""})
    if _setting("openrouter_api_key"):
        out.append({"provider": "openrouter", "kind": "free", "label": LABEL["openrouter"],
                    "detail": _setting("openrouter_model")})
    models = _ollama_models() if probe else []
    if models:
        out.append({"provider": "ollama", "kind": "free", "label": LABEL["ollama"],
                    "detail": ", ".join(models[:3])})
    if _setting("ai_base_url"):
        out.append({"provider": "custom", "kind": "free", "label": LABEL["custom"],
                    "detail": _setting("ai_base_url")})
    return out


def _build(provider: str, overrides: dict) -> Model | None:
    model = str(overrides.get("ai_model") or _setting("ai_model") or "")
    t = _timeout()
    if provider in ("claude", "codex"):
        path = _which(provider)
        if not path:
            return None
        return Model(provider, model or DEFAULT_MODEL[provider], binary=path,
                     timeout=max(t, CLI_TIMEOUT))
    if provider in ("anthropic", "openai", "gemini"):
        key = str(overrides.get("api_key") or _setting(KEY_SETTING[provider]))
        if not key:
            return None
        url = {"anthropic": ANTHROPIC_URL, "openai": OPENAI_URL, "gemini": GEMINI_URL}[provider]
        return Model(provider, model or DEFAULT_MODEL[provider], url=url, api_key=key,
                     timeout=max(t, 30.0))
    if provider == "openrouter":
        key = str(overrides.get("api_key") or _setting("openrouter_api_key"))
        if not key:
            return None
        return Model("openrouter", model or _setting("openrouter_model"), url=OPENROUTER_URL,
                     api_key=key, timeout=t)
    if provider == "ollama":
        names = _ollama_models()
        if not names and not model:
            return None
        return Model("ollama", model or names[0], url=f"{OLLAMA_URL}/v1/chat/completions",
                     timeout=max(t, 60.0))
    if provider == "custom":
        base = str(overrides.get("ai_base_url") or _setting("ai_base_url"))
        if not base:
            return None
        return Model("custom", model, url=endpoint(base),
                     api_key=str(overrides.get("api_key") or _setting("ai_api_key")
                                 or _setting("openrouter_api_key")), timeout=t)
    return None


def resolve(overrides: dict | None = None) -> Model | None:
    """The model to use now, or None (no model: callers use the rules)."""
    o = overrides or {}
    choice = str(o.get("ai_provider") or _setting("ai_provider") or "auto").lower()
    if choice == "off":
        return None
    if choice != "auto":
        return _build(choice, o) if choice in PROVIDERS else None
    # auto: only what OpenLeads was already pointed at, never a subscription or paid key.
    if o.get("ai_base_url") or _setting("ai_base_url"):
        return _build("custom", o)
    if o.get("api_key") or _setting("openrouter_api_key"):
        return _build("openrouter", o)
    return None


def available() -> bool:
    return resolve() is not None


def problem() -> str:
    """Why the chosen provider can't be used right now ('' if it can, or none is chosen)."""
    choice = _setting("ai_provider").lower() or "auto"
    if choice in ("auto", "off") or resolve() is not None:
        return ""
    if choice in ("claude", "codex"):
        return (f"ai_provider is {choice}, but the `{choice}` command isn't on PATH. "
                f"Install it and log in, or run `openleads setup ai`.")
    if choice in KEY_SETTING:
        return f"ai_provider is {choice}, but {KEY_SETTING[choice]} isn't set."
    if choice == "ollama":
        return "ai_provider is ollama, but no Ollama server with a model is running."
    return f"ai_provider is {choice}, but it isn't set up."


# --- talking to it ------------------------------------------------------------ #
def _run(cmd: list, stdin: str, timeout: float, cwd: str) -> tuple:
    try:
        p = subprocess.run(cmd, input=stdin, capture_output=True, text=True, timeout=timeout,
                           cwd=cwd, encoding="utf-8", errors="replace")
    except subprocess.TimeoutExpired:
        raise AIError(f"{os.path.basename(cmd[0])} took longer than {int(timeout)}s") from None
    except OSError as e:
        raise AIError(f"couldn't start {cmd[0]}: {e}") from None
    return p.returncode, p.stdout or "", p.stderr or ""


def _post(url: str, payload: dict, headers: dict, timeout: float) -> dict:
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"),
                                 headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def _prompt(messages: list) -> str:
    """One stdin prompt for a CLI: the instructions, then the request."""
    system = "\n\n".join(m["content"] for m in messages if m.get("role") == "system")
    rest = "\n\n".join(m["content"] for m in messages if m.get("role") != "system")
    if not system:
        return rest
    return f"{system}\n\n---\n\n{rest}"


def _clean(text: str) -> str:
    return re.sub(r"<think>.*?</think>", "", text or "", flags=re.DOTALL).strip()


def _claude(m: Model, messages: list, runner) -> str:
    base = [m.binary, "-p", "--output-format", "json", "--tools", "",
            "--permission-mode", "dontAsk", "--disable-slash-commands"]
    if m.model:
        base += ["--model", m.model]
    prompt = _prompt(messages)
    with tempfile.TemporaryDirectory(prefix="openleads-ai-") as cwd:
        code, out, err = runner(base + ["--no-session-persistence"], prompt, m.timeout, cwd)
        if code != 0 and "unknown option" in err and "no-session-persistence" in err:
            code, out, err = runner(base, prompt, m.timeout, cwd)   # Claude Code < 2.0.63
    try:
        data = json.loads(out.strip().splitlines()[-1]) if out.strip() else {}
    except ValueError:
        data = {}
    if data.get("is_error") or (code != 0 and not data.get("result")):
        why = data.get("result") or err.strip().splitlines()[-1:] or ["no output"]
        raise AIError(f"claude: {why if isinstance(why, str) else why[0]}"[:300])
    text = data.get("result")
    if not isinstance(text, str) or not text.strip():
        raise AIError("claude: empty reply")
    return _clean(text)


def _codex(m: Model, messages: list, runner) -> str:
    with tempfile.TemporaryDirectory(prefix="openleads-ai-") as cwd:
        out_path = os.path.join(cwd, "last-message.txt")
        cmd = [m.binary, "exec", "--config", "features.plugins=false",
               "--config", "features.apps=false", "--ephemeral", "--skip-git-repo-check",
               "-s", "read-only"]
        if m.model:
            cmd += ["--model", m.model]
        cmd += ["--output-last-message", out_path, "-"]
        code, _out, err = runner(cmd, _prompt(messages), m.timeout, cwd)
        text = ""
        if os.path.exists(out_path):
            with open(out_path, encoding="utf-8", errors="replace") as f:
                text = f.read()
    if code != 0 and not text.strip():
        raise AIError(f"codex: {(err.strip().splitlines() or ['failed'])[-1]}"[:300])
    if not text.strip():
        raise AIError("codex: empty reply")
    return _clean(text)


def _anthropic(m: Model, messages: list, http, max_tokens: int, temperature: float) -> str:
    system = "\n\n".join(x["content"] for x in messages if x.get("role") == "system")
    rest = [{"role": x["role"], "content": x["content"]} for x in messages
            if x.get("role") in ("user", "assistant")]
    payload = {"model": m.model, "max_tokens": max_tokens, "messages": rest,
               "temperature": temperature}
    if system:
        payload["system"] = system
    headers = {"x-api-key": m.api_key, "anthropic-version": "2023-06-01",
               "content-type": "application/json"}
    data = http(m.url, payload, headers, m.timeout)
    parts = [c.get("text", "") for c in data.get("content") or [] if c.get("type") == "text"]
    if not "".join(parts).strip():
        raise AIError("anthropic: empty reply")
    return _clean("".join(parts))


def _openai_compatible(m: Model, messages: list, http, max_tokens: int,
                       temperature: float) -> str:
    headers = {"Content-Type": "application/json"}
    if m.api_key:
        headers["Authorization"] = f"Bearer {m.api_key}"
    if m.provider == "openrouter":
        headers["X-Title"] = "OpenLeads"
    payload = {"messages": messages, "max_tokens": max_tokens, "temperature": temperature}
    if m.model:
        payload["model"] = m.model
    data = http(m.url, payload, headers, m.timeout)
    content = data["choices"][0]["message"]["content"]
    if not isinstance(content, str) or not content.strip():
        raise AIError("empty reply")
    return _clean(content)


def chat(messages: list, model: Model | None = None, *, max_tokens: int = 900,
         temperature: float = 0.4, runner=None, http=None) -> str:
    """One answer from the connected model. Raises :class:`AIError` on any failure."""
    m = model or resolve()
    if m is None:
        raise AIError(problem() or "no model connected; run `openleads setup ai`")
    try:
        if m.provider == "claude":
            return _claude(m, messages, runner or _run)
        if m.provider == "codex":
            return _codex(m, messages, runner or _run)
        if m.provider == "anthropic":
            return _anthropic(m, messages, http or _post, max_tokens, temperature)
        return _openai_compatible(m, messages, http or _post, max_tokens, temperature)
    except AIError:
        raise
    except Exception as e:  # noqa: BLE001 — transport or shape problems all mean "fall back"
        raise AIError(f"{m.provider}: {type(e).__name__}: {e}"[:300]) from None


def parse_json(text: str) -> dict:
    """The first JSON object in ``text`` (models wrap it in fences or prose)."""
    text = re.sub(r"^```(?:json)?|```$", "", (text or "").strip(), flags=re.M).strip()
    try:
        out = json.loads(text)
    except ValueError:
        found = re.search(r"\{.*\}", text, re.DOTALL)
        if not found:
            raise AIError("reply wasn't JSON") from None
        try:
            out = json.loads(found.group(0))
        except ValueError:
            raise AIError("reply wasn't valid JSON") from None
    if not isinstance(out, dict):
        raise AIError("reply wasn't a JSON object")
    return out


def complete_json(system: str, user: str, model: Model | None = None, **kw) -> dict:
    """Ask for a JSON object; returns it parsed. Raises :class:`AIError`."""
    text = chat([{"role": "system", "content": system + "\nAnswer with one JSON object only."},
                 {"role": "user", "content": user}], model, **kw)
    return parse_json(text)
