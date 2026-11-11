"""`openleads setup ai`: choose the model OpenLeads thinks with.

Three ways in, all optional (without one, OpenLeads uses its built-in rules):

1. a subscription you already pay for, through its own CLI (``claude``, ``codex``);
2. an API key (Anthropic, OpenAI, Gemini);
3. free models: OpenRouter's free tier, Ollama on this computer, or any
   OpenAI-compatible endpoint.

Nothing is chosen for you: a subscription or a paid key is only used after you pick
it here (or set ``ai_provider``). Every choice is tested with one tiny call before
it's saved; if the test fails, your previous choice stays.
"""
from __future__ import annotations

import argparse
import getpass
import sys
import time

from openleads import ai, settings, ui

CHOICES = ai.PROVIDERS + ("off",)
ENV_FOR = {"anthropic": "ANTHROPIC_API_KEY", "openai": "OPENAI_API_KEY",
           "gemini": "GEMINI_API_KEY", "openrouter": "OPENROUTER_API_KEY"}
KEY_HINT = {"anthropic": "console.anthropic.com → API keys",
            "openai": "platform.openai.com → API keys",
            "gemini": "aistudio.google.com → Get API key (has a free tier)",
            "openrouter": "openrouter.ai → Keys (free models need no credit)"}


def _interactive() -> bool:
    return sys.stdin.isatty() and sys.stdout.isatty()


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="openleads setup ai",
                                description="Choose the model OpenLeads uses to write, plan "
                                            "and sort replies.")
    p.add_argument("--use", metavar="PROVIDER",
                   help="one of: " + ", ".join(CHOICES))
    p.add_argument("--model", help="model name (default: a good one for the provider)")
    p.add_argument("--no-test", action="store_true", help="save without the test call")
    return p


def _menu() -> list:
    """Detected options first, then ones you can set up with a key, then off."""
    found = ai.detect()
    have = {d["provider"] for d in found}
    rows = [dict(d, ready=True) for d in found]
    for name in ("anthropic", "openai", "gemini", "openrouter"):
        if name not in have:
            rows.append({"provider": name, "kind": "api key" if name != "openrouter" else "free",
                         "label": ai.LABEL[name], "detail": "paste a key", "ready": False})
    rows.append({"provider": "off", "kind": "", "label": "No model (built-in rules only)",
                 "detail": "", "ready": True})
    return rows


def _status_line() -> str:
    m = ai.resolve()
    if m is not None:
        return f"Using: {m.label}"
    why = ai.problem()
    return f"Not working: {why}" if why else "No model connected; OpenLeads uses its built-in rules."


def _print_menu(rows: list) -> None:
    for i, r in enumerate(rows, 1):
        tag = f"[{r['kind']}]" if r["kind"] else ""
        detail = f"  {ui.c(r['detail'], ui.FAINT)}" if r["detail"] else ""
        print(f"  {i}. {r['label']} {ui.c(tag, ui.GREY)}{detail}")


def _ask_key(provider: str) -> bool:
    env = ENV_FOR[provider]
    print(ui.c(f"  Get one at {KEY_HINT[provider]}. It's stored in your OpenLeads config "
               f"(or set {env} instead).", ui.FAINT))
    try:
        key = getpass.getpass(f"  {ai.LABEL[provider]} key: ").strip()
    except (EOFError, KeyboardInterrupt):
        print()
        return False
    if not key:
        return False
    settings.set(ai.KEY_SETTING[provider], key)
    return True


def test_call(model) -> tuple:
    t = time.time()
    try:
        text = ai.chat([{"role": "system", "content": "Reply with the single word: ready"},
                        {"role": "user", "content": "Are you there?"}], model, max_tokens=20,
                       temperature=0)
    except ai.AIError as e:
        return False, str(e)
    return True, f"answered {text[:30]!r} in {time.time() - t:.1f}s"


def apply(provider: str, model: str = "", test: bool = True, interactive: bool = False) -> int:
    """Switch to ``provider`` if it works. 0 = saved, 1 = didn't work (nothing changed)."""
    provider = provider.lower()
    if provider == "off":
        settings.set("ai_provider", "off")
        print("  Saved: no model. OpenLeads uses its built-in rules for writing, plans and "
              "sorting replies.")
        return 0
    if provider in ai.KEY_SETTING and not settings.get(ai.KEY_SETTING[provider]):
        if not (interactive and _ask_key(provider)):
            print(f"[!] {provider} needs a key: set {ENV_FOR[provider]} (or run "
                  f"`openleads setup ai` in a terminal to paste one).", file=sys.stderr)
            return 1
    if provider == "custom" and not settings.get("ai_base_url"):
        print("[!] custom needs an endpoint: `openleads config set ai_base_url "
              "http://host:port/v1` first.", file=sys.stderr)
        return 1
    overrides = {"ai_provider": provider}
    if model:
        overrides["ai_model"] = model
    elif provider not in ("openrouter", "ollama", "custom"):
        overrides["ai_provider_model"] = ""        # a switch starts from the default model
    m = ai.resolve(overrides)
    if m is None:
        if provider in ("claude", "codex"):
            print(f"[!] The `{provider}` command isn't installed here. Install it, log in once, "
                  f"then run this again.", file=sys.stderr)
        elif provider == "ollama":
            print("[!] Ollama isn't running (or has no models). Start it and `ollama pull "
                  "llama3.2`, then run this again.", file=sys.stderr)
        else:
            print(f"[!] {provider} isn't set up.", file=sys.stderr)
        return 1
    if test:
        print(ui.c(f"  Testing {m.label}...", ui.FAINT))
        ok, detail = test_call(m)
        if not ok:
            print(f"[!] {m.label} didn't answer: {detail}", file=sys.stderr)
            print("    Nothing changed. Fix that (for a CLI: run it once and log in) and try "
                  "again.", file=sys.stderr)
            return 1
        print(f"  Connected: {m.label} ({detail}).")
    settings.set("ai_provider", provider)
    if provider in ("openrouter", "ollama", "custom"):
        if model:
            settings.set("ai_model", model)
    else:
        settings.set("ai_provider_model", model)     # blank clears the last provider's
    if provider in ("claude", "codex", "anthropic", "openai", "gemini"):
        print(ui.c("  Uses your subscription or key. Writing a draft or a plan is one short "
                   "call; nothing runs in the background unless you schedule it.", ui.FAINT))
    return 0


def cmd(argv: list) -> int:
    args = _parser().parse_args(argv)
    if args.use:
        if args.use.lower() not in CHOICES:
            print(f"[!] unknown provider '{args.use}'. Choose one of: {', '.join(CHOICES)}",
                  file=sys.stderr)
            return 2
        return apply(args.use, args.model or "", test=not args.no_test,
                     interactive=_interactive())
    rows = _menu()
    print(ui.c("  The model OpenLeads thinks with", ui.WHITE, ui.BOLD))
    print(f"  {_status_line()}\n")
    _print_menu(rows)
    if not _interactive():
        ready = [r["provider"] for r in rows if r["ready"] and r["provider"] != "off"]
        hint = f"openleads setup ai --use {ready[0]}" if ready else "openleads setup ai --use openrouter"
        print(f"\n  Pick one with `{hint}` (or any of: {', '.join(CHOICES)}).")
        return 0
    try:
        pick = input(ui.c("\n  Number (Enter keeps what you have): ", ui.WHITE)).strip()
    except (EOFError, KeyboardInterrupt):
        print()
        return 0
    if not pick:
        return 0
    if not pick.isdigit() or not 1 <= int(pick) <= len(rows):
        print(f"[!] pick a number from 1 to {len(rows)}", file=sys.stderr)
        return 2
    return apply(rows[int(pick) - 1]["provider"], args.model or "", test=not args.no_test,
                 interactive=True)
