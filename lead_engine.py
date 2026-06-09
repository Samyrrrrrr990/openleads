"""
Back-compat shim for OpenLeads v1.

The engine moved into the installable ``openleads`` package in v2.0. This module
re-exports the v1 public helpers and forwards the old CLI to ``openleads find``
so existing scripts keep working. Prefer the new entry point:

    openleads find "20 founders"        # or: python -m openleads find ...
"""
from __future__ import annotations

import sys

# Re-export the v1 public API from its new homes (behavior unchanged).
from openleads.emails.permute import (  # noqa: F401
    candidate_emails,
    domain_of,
    name_parts,
)
from openleads.emails.resolve import find_email  # noqa: F401
from openleads.sources.yc import (  # noqa: F401
    pick_exec,
    split_location,
)


def _translate(argv: list[str]) -> list[str]:
    """Map v1 flags onto the new ``find`` subcommand."""
    out: list[str] = []
    for a in argv:
        if a == "--no-write":
            out += ["--out", "-"]   # v1 'print only' ≈ write CSV to stdout
        else:
            out.append(a)
    return out


def main() -> int:
    sys.stderr.write(
        "[deprecation] `lead_engine.py` is now a shim. Use `openleads find ...` "
        "(or `python -m openleads find ...`).\n"
    )
    from openleads.cli import main as cli_main
    return cli_main(["find"] + _translate(sys.argv[1:]))


if __name__ == "__main__":
    raise SystemExit(main())
