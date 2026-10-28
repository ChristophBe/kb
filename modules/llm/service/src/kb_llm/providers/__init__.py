from collections.abc import Callable

from ..config import Settings
from .base import Provider
from .fake import FakeProvider
from .ollama import OllamaProvider

# Add new vendors here (e.g. "anthropic", "openai"); select with KB_LLM_PROVIDER.
REGISTRY: dict[str, Callable[[Settings], Provider]] = {
    "ollama": lambda s: OllamaProvider(s.ollama_url, s.chat_model, s.embedding_model),
    "fake": lambda s: FakeProvider(s.embedding_dimensions),
}


def build_provider(settings: Settings) -> Provider:
    try:
        factory = REGISTRY[settings.llm_provider]
    except KeyError:
        raise ValueError(
            f"unknown llm provider {settings.llm_provider!r}; known: {sorted(REGISTRY)}"
        ) from None
    return factory(settings)
