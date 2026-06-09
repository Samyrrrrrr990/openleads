"""
Source registry: discovers built-in sources and user plugins, maps ``name → Source``.

Built-ins are every :class:`~openleads.sources.base.Source` subclass defined in
modules of this package. User plugins are ``*.py`` files in
``~/.openleads/sources/`` — drop one in to add a whole vertical, no reinstall.
"""
from __future__ import annotations

import importlib
import importlib.util
import inspect
import pkgutil

from openleads.config import plugins_dir
from openleads.sources.base import Source

_registry: dict[str, Source] | None = None


def _collect_from_module(module, found: dict[str, Source]) -> None:
    for _, obj in inspect.getmembers(module, inspect.isclass):
        if issubclass(obj, Source) and obj is not Source and getattr(obj, "name", ""):
            # A source defined in this module (not merely imported into it).
            if obj.__module__ == module.__name__:
                try:
                    inst = obj()
                except Exception:
                    continue
                found[inst.name] = inst


def _load_builtins(found: dict[str, Source]) -> None:
    import openleads.sources as pkg

    for mod in pkgutil.iter_modules(pkg.__path__):
        if mod.name in ("base", "__init__"):
            continue
        try:
            module = importlib.import_module(f"{pkg.__name__}.{mod.name}")
        except Exception:
            continue
        _collect_from_module(module, found)


def _load_plugins(found: dict[str, Source]) -> None:
    try:
        pdir = plugins_dir()
    except Exception:
        return
    for path in sorted(pdir.glob("*.py")):
        if path.name.startswith("_"):
            continue
        try:
            spec = importlib.util.spec_from_file_location(f"openleads_plugin_{path.stem}", path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)  # type: ignore[union-attr]
        except Exception:
            continue
        _collect_from_module(module, found)


def get_registry(reload: bool = False) -> dict[str, Source]:
    """Return ``{name: Source}`` for all available sources (built-in + plugins)."""
    global _registry
    if _registry is None or reload:
        found: dict[str, Source] = {}
        _load_builtins(found)
        _load_plugins(found)  # user plugins can override built-ins by name
        _registry = found
    return _registry


def get_source(name: str) -> Source | None:
    return get_registry().get(name)


def list_sources() -> list:
    """SourceInfo for every registered source, sorted by name."""
    return [s.info() for s in sorted(get_registry().values(), key=lambda s: s.name)]


def default_source() -> str:
    """The source used when intent can't infer one. ``yc`` if present, else first."""
    reg = get_registry()
    if "yc" in reg:
        return "yc"
    return next(iter(sorted(reg)), "yc")
