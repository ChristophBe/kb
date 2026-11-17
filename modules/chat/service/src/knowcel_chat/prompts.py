"""Prompt templates: text with `{sources}` and `{history}` variables, written by
users (per conversation) and platform admins (the defaults for everyone)."""

import string
from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum

MAX_TEMPLATE_LENGTH = 10_000

SYSTEM_PROMPT = "You are a helpful assistant for a personal knowledge base. Answer concisely."
RAG_PROMPT = (
    "Answer using the numbered sources below when they are relevant and cite them like [1]. "
    "Sources from the user manual explain how to use this knowledge base tool. "
    "If the sources do not contain the answer, say so.\n\nSources:\n{sources}"
)
NO_SOURCES_PROMPT = (
    "Nothing in the knowledge base is related to this question. Say so before "
    "answering from general knowledge, and don't cite sources."
)

# The variables a template can use, with what they stand for.
VARIABLES = {
    "sources": "The numbered passages the answer is grounded in, as [1] Title: text.",
    "history": "The earlier messages of the conversation, one per paragraph.",
}


class TemplateName(StrEnum):
    """The global templates an admin can change."""

    SYSTEM = "system"
    SOURCES = "sources"
    NO_SOURCES = "no_sources"


DEFAULTS = {
    TemplateName.SYSTEM: SYSTEM_PROMPT,
    TemplateName.SOURCES: RAG_PROMPT,
    TemplateName.NO_SOURCES: NO_SOURCES_PROMPT,
}


class TemplateError(ValueError):
    """The template is not valid; the message says why, for the user."""


@dataclass(frozen=True)
class Template:
    parts: tuple[tuple[str, str | None], ...]

    @property
    def variables(self) -> set[str]:
        return {name for _, name in self.parts if name is not None}

    def render(self, values: Mapping[str, str]) -> str:
        return "".join(
            text + (values[name] if name is not None else "") for text, name in self.parts
        )


def parse(template: str, required: tuple[str, ...] = ()) -> Template:
    """Checks a template: `{name}` for a known variable, `{{` and `}}` for
    literal braces. Raises TemplateError otherwise."""
    if len(template) > MAX_TEMPLATE_LENGTH:
        raise TemplateError(f"The prompt must not be longer than {MAX_TEMPLATE_LENGTH} characters")
    available = ", ".join("{" + v + "}" for v in VARIABLES)
    parts: list[tuple[str, str | None]] = []
    try:
        for text, field, spec, conversion in string.Formatter().parse(template):
            if field is not None and (spec or conversion or field not in VARIABLES):
                raise TemplateError(
                    f"Unknown variable {{{field}}}. Available variables: {available}. "
                    "Write {{ and }} for literal braces."
                )
            parts.append((text, field))
    except ValueError as err:
        raise TemplateError(
            f"Braces don't match ({err}). Write {{{{ and }}}} for literal braces."
        ) from err
    parsed = Template(tuple(parts))
    for name in required:
        if name not in parsed.variables:
            raise TemplateError(f"The template must contain {{{name}}}")
    return parsed
