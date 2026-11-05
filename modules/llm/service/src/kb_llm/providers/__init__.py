from collections.abc import Callable

from ..config import Settings
from .base import Provider
from .fake import FakeProvider
from .ollama import OllamaLimits, OllamaProvider

# Add new vendors here (e.g. "anthropic", "openai"); select with KB_LLM_PROVIDER.
REGISTRY: dict[str, Callable[[Settings], Provider]] = {
    "ollama": lambda s: OllamaProvider(
        s.ollama_url,
        s.chat_model,
        s.embedding_model,
        OllamaLimits(
            connect_timeout=s.provider_connect_timeout,
            first_token_timeout=s.provider_first_token_timeout,
            generate_timeout=s.provider_generate_timeout,
            embed_timeout=s.provider_embed_timeout,
            list_timeout=s.provider_list_timeout,
            attempts=s.provider_attempts,
            retry_delay=s.provider_retry_delay,
        ),
    ),
    "fake": lambda s: FakeProvider(s.embedding_dimensions, s.fake_token_delay),
}


def build_provider(settings: Settings) -> Provider:
    try:
        factory = REGISTRY[settings.llm_provider]
    except KeyError:
        raise ValueError(
            f"unknown llm provider {settings.llm_provider!r}; known: {sorted(REGISTRY)}"
        ) from None
    return factory(settings)
