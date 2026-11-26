"""Versioned prompt templates.

A `PromptSet` is loaded from a directory: system.md, role.md, modes/<mode>.md and
fragments.toml (placeholders use string.Template `${name}` syntax). Production uses
this package's own directory; tests also load the verbatim legacy set to prove the
assembly logic is unchanged (see tests/golden).

`VERSION` holds `<version> <sha256>`. The hash covers every template file, so editing
a template without bumping the version fails a test, and bumping the version requires
a matching live evaluation report (enforced in CI).
"""

from __future__ import annotations

import hashlib
import tomllib
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from string import Template

PROMPTS_DIR = Path(__file__).resolve().parent
STRUCTURED_MODES = ("directions", "theme", "scheme", "copies")


@dataclass(frozen=True)
class PromptSet:
    system: str
    role: str
    modes: dict[str, str]
    fragments: dict[str, str]

    def frag(self, fragment: str, /, **values: object) -> str:
        """Render a fragment; every placeholder must be supplied (KeyError otherwise).
        `fragment` is positional-only so placeholders may themselves be called `name`."""
        return Template(self.fragments[fragment]).substitute({k: str(v) for k, v in values.items()})

    @classmethod
    def load(cls, directory: Path) -> PromptSet:
        def read(rel: str) -> str:
            return (directory / rel).read_text(encoding="utf-8").rstrip("\n")

        return cls(
            system=read("system.md"),
            role=read("role.md"),
            modes={m: read(f"modes/{m}.md") for m in STRUCTURED_MODES},
            fragments=tomllib.loads((directory / "fragments.toml").read_text(encoding="utf-8")),
        )


def template_files(directory: Path = PROMPTS_DIR) -> list[Path]:
    return sorted(
        [directory / "system.md", directory / "role.md", directory / "fragments.toml"]
        + [directory / "modes" / f"{m}.md" for m in STRUCTURED_MODES]
    )


def content_hash(directory: Path = PROMPTS_DIR) -> str:
    h = hashlib.sha256()
    for path in template_files(directory):
        h.update(path.relative_to(directory).as_posix().encode())
        h.update(b"\0")
        h.update(path.read_bytes())
        h.update(b"\0")
    return h.hexdigest()


def _read_version() -> tuple[str, str]:
    version, digest = (PROMPTS_DIR / "VERSION").read_text(encoding="utf-8").split()
    return version, digest


PROMPT_VERSION, PROMPT_HASH = _read_version()


@lru_cache(maxsize=1)
def current() -> PromptSet:
    return PromptSet.load(PROMPTS_DIR)
