from collections.abc import Callable

from ..config import Settings
from .anthropic import AnthropicLimits, AnthropicProvider
from .base import Provider
from .fake import FakeProvider
from .ollama import OllamaLimits, OllamaProvider

# Add new vendors here (e.g. "openai"); select with KB_LLM_PROVIDER.
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
    "anthropic": lambda s: AnthropicProvider(
        s.anthropic_api_key.get_secret_value() if s.anthropic_api_key else None,
        s.anthropic_chat_model,
        s.anthropic_max_tokens,
        AnthropicLimits(
            connect_timeout=s.provider_connect_timeout,
            read_timeout=s.provider_first_token_timeout,
            request_timeout=s.provider_generate_timeout,
            status_timeout=s.provider_list_timeout,
            attempts=s.provider_attempts,
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
