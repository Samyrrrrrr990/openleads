"""The MCP Registry proves we own the PyPI package by finding this line in its README."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_readme_carries_the_mcp_registry_name():
    name = json.loads((ROOT / "server.json").read_text(encoding="utf-8"))["name"]
    assert f"mcp-name: {name}" in (ROOT / "README.md").read_text(encoding="utf-8")
