"""Prints the settings of Python components as JSON, for modgen's
docs/configuration.md.

Usage: uv run python tools/modgen/settings.py <root> <component>=<module>[:<class>]...

<module> is the component's config module (e.g. knowcel_chat.config) and <class>
its settings class (default `Settings`). For every field, in declaration order, the output gives its
environment variable, its default and its description: the comment block
above the field in the class that declares it (or, for a field that only
changes a default, in the nearest base class with one).
"""

import importlib
import inspect
import io
import json
import re
import sys
import tokenize
from pathlib import Path
from typing import Any

from pydantic.fields import FieldInfo
from pydantic_core import PydanticUndefined

_FIELD = re.compile(r"^    (\w+)\s*:")


def comments(cls: type) -> dict[str, str]:
    """The comment block directly above each field of the class body, or the
    comment at the end of the field's line when there is no block."""
    found: dict[str, str] = {}
    block: list[str] = []
    lines = inspect.getsource(cls).splitlines()
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("#"):
            block.append(stripped.removeprefix("#").strip())
            continue
        if match := _FIELD.match(line):
            text = " ".join(block) or _trailing_comment(line)
            if text:
                found[match.group(1)] = text
        block = []
    return found


def _trailing_comment(line: str) -> str:
    try:
        tokens = tokenize.generate_tokens(io.StringIO(line.strip() + "\n").readline)
        return next(
            (t.string.removeprefix("#").strip() for t in tokens if t.type == tokenize.COMMENT), ""
        )
    except tokenize.TokenError:
        return ""


def default(field: FieldInfo, root: Path) -> str:
    value = field.get_default(call_default_factory=True)
    if value is None or value is PydanticUndefined:
        return ""
    match value:
        case bool():
            return str(value).lower()
        case float() if value.is_integer():
            return str(int(value))
        case Path():
            # Paths under the repository relative to it, as in the image (/app).
            try:
                return value.resolve().relative_to(root.resolve()).as_posix()
            except ValueError:
                return str(value)
        case _:
            return str(value)


def describe(cls: Any, root: Path) -> list[dict[str, object]]:
    prefix = cls.model_config.get("env_prefix", "")
    # The class and its bases from this repository (knowcel_platform, knowcel_<component>).
    docs = [comments(c) for c in cls.__mro__ if c.__module__.startswith("knowcel_")]
    out: list[dict[str, object]] = []
    for name, field in cls.model_fields.items():
        declared = next(c for c in cls.__mro__ if name in vars(c).get("__annotations__", {}))
        out.append(
            {
                "field": name,
                "env": (prefix + name).upper(),
                "default": default(field, root),
                "description": next((d[name] for d in docs if name in d), ""),
                "own": declared is cls,
            }
        )
    return out


def main(args: list[str]) -> None:
    root = Path(args[0])
    result = {}
    for arg in args[1:]:
        component, target = arg.split("=", 1)
        module, _, name = target.partition(":")
        result[component] = describe(
            getattr(importlib.import_module(module), name or "Settings"), root
        )
    sys.stdout.write(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main(sys.argv[1:])
