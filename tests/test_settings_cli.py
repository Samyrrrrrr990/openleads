"""Tests for the settings store and CLI wiring (network-free)."""
import pytest


@pytest.fixture()
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENLEADS_HOME", str(tmp_path))
    # Ensure a stray .env in cwd doesn't leak into these tests.
    monkeypatch.chdir(tmp_path)
    import importlib

    import openleads.settings as s
    importlib.reload(s)
    return s


def test_default_get(home):
    assert home.get("smtp_port") == 465
    assert home.get("daily_cap") == 40
    assert home.get("include_risky") is False


def test_set_and_persist_nonsecret(home, tmp_path):
    home.set("sender_name", "Ada")
    assert home.get("sender_name") == "Ada"
    assert (tmp_path / "config.json").exists()
    assert not (tmp_path / "secrets.json").exists()  # non-secret stays out of secrets


def test_secret_stored_separately_and_masked(home, tmp_path):
    home.set("openrouter_api_key", "sk-abcdef123456")
    assert home.get("openrouter_api_key") == "sk-abcdef123456"
    secrets = (tmp_path / "secrets.json")
    assert secrets.exists()
    # 0600 perms on the secret file
    import stat
    mode = stat.S_IMODE(secrets.stat().st_mode)
    assert mode == 0o600
    listing = {i["key"]: i for i in home.all_settings()}
    assert listing["openrouter_api_key"]["value"].endswith("3456")
    assert "abcdef" not in listing["openrouter_api_key"]["value"]  # masked


def test_env_overrides_store(home, monkeypatch):
    home.set("smtp_user", "stored@x.com")
    monkeypatch.setenv("SMTP_USER", "env@x.com")
    assert home.get("smtp_user") == "env@x.com"
    assert home.source_of("smtp_user") == "env"


def test_int_and_bool_coercion(home):
    home.set("daily_cap", "55")
    assert home.get("daily_cap") == 55
    home.set("include_risky", "yes")
    assert home.get("include_risky") is True


def test_choices_validation(home):
    with pytest.raises(ValueError):
        home.set("smtp_provider", "carrier-pigeon")
    home.set("smtp_provider", "gmail")
    assert home.get("smtp_provider") == "gmail"


def test_unknown_key_rejected(home):
    with pytest.raises(KeyError):
        home.set("totally_made_up", "x")


def test_cli_config_set_get(home, capsys):
    import argparse

    from openleads import config_cmd
    config_cmd.main(argparse.Namespace(action="set", key="sender_org", value="Acme"))
    config_cmd.main(argparse.Namespace(action="get", key="sender_org", value=None))
    out = capsys.readouterr().out
    assert "Acme" in out
