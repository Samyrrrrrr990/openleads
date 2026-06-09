"""
Output writers: CSV (v1-compatible), JSON (array), NDJSON (one lead per line).

A single module (not an ``output/`` package) on purpose — ``output/`` is
gitignored for scraped data, and writers are small enough to live together.
"""
from __future__ import annotations

import csv
import json
import sys
from typing import Iterable

from openleads.models import CSV_FIELDS, Lead


def _open_out(path: str | None):
    """Return (file_obj, should_close). ``None`` or ``-`` means stdout."""
    if path in (None, "-"):
        return sys.stdout, False
    return open(path, "w", newline="", encoding="utf-8"), True


def write_csv(leads: list[Lead], path: str | None = "leads.csv") -> None:
    f, close = _open_out(path)
    try:
        w = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        w.writeheader()
        for lead in leads:
            w.writerow(lead.to_csv_row())
    finally:
        if close:
            f.close()


def write_json(leads: list[Lead], path: str | None = None) -> None:
    f, close = _open_out(path)
    try:
        json.dump([lead.to_dict() for lead in leads], f, indent=2, ensure_ascii=False)
        f.write("\n")
    finally:
        if close:
            f.close()


def write_ndjson(leads: Iterable[Lead], path: str | None = None) -> None:
    f, close = _open_out(path)
    try:
        for lead in leads:
            f.write(json.dumps(lead.to_dict(), ensure_ascii=False) + "\n")
    finally:
        if close:
            f.close()


WRITERS = {"csv": write_csv, "json": write_json, "ndjson": write_ndjson}


def write(leads: list[Lead], fmt: str = "csv", path: str | None = None) -> None:
    """Dispatch to the writer for ``fmt`` (csv|json|ndjson)."""
    writer = WRITERS.get(fmt)
    if writer is None:
        raise ValueError(f"unknown format: {fmt!r} (choose csv|json|ndjson)")
    # csv defaults to leads.csv; json/ndjson default to stdout when no path given.
    if path is None and fmt == "csv":
        path = "leads.csv"
    writer(leads, path)
