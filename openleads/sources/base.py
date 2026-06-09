"""
The ``Source`` base class — the contract every data source implements.

A source knows how to turn a :class:`~openleads.models.Query` into a stream of
normalized :class:`~openleads.models.Entity` records pulled from a free, public,
keyless dataset. The engine takes it from there (email resolution, scoring,
output), so a source is small: just discovery + normalization.

To add a vertical, subclass ``Source`` in a module under ``openleads/sources/``
or drop a ``*.py`` file in ``~/.openleads/sources/``. The registry finds it
automatically.
"""
from __future__ import annotations

from typing import Iterator

from openleads.models import Entity, Query, SourceInfo


class Source:
    """Subclass and set the class attributes, then implement :meth:`search`."""

    name: str = ""               # registry key, e.g. "yc" (lowercase, no spaces)
    kind: str = "company"        # "company" | "people"
    vertical: str = ""           # human label, e.g. "startup founders"
    description: str = ""        # one line shown by `openleads sources`

    def __init__(self) -> None:
        if not self.name:
            raise ValueError(f"{type(self).__name__} must set a non-empty `name`")
        # The engine injects the shared cache here before calling search().
        self.cache = None

    def search(self, query: Query) -> Iterator[Entity]:  # pragma: no cover - abstract
        """Yield :class:`Entity` records matching ``query``. Override this."""
        raise NotImplementedError

    def info(self) -> SourceInfo:
        return SourceInfo(
            name=self.name, kind=self.kind,
            description=self.description, vertical=self.vertical,
        )
