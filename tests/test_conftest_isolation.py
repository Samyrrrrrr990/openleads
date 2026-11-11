"""The suite never reaches a real model or picks up the developer's own keys."""
import os

import pytest

from openleads import ai, settings


def test_no_model_keys_leak_in_from_the_environment():
    for k in ("OPENROUTER_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY",
              "GOOGLE_API_KEY", "OPENLEADS_AI_PROVIDER", "OPENLEADS_AI_MODEL",
              "OPENLEADS_AI_PROVIDER_MODEL", "OPENLEADS_AI_BASE_URL", "OPENLEADS_AI_API_KEY"):
        assert k not in os.environ, k


def test_dotenv_is_never_read():
    assert getattr(settings._load_dotenv_once, "_done", False)


def test_model_http_is_refused():
    with pytest.raises(ai.AIError):
        ai._post("https://api.anthropic.com/v1/messages", {}, {}, 1.0)
