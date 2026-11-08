from collections.abc import Callable
from dataclasses import dataclass

from ..config import Settings
from .anthropic import AnthropicLimits, AnthropicProvider
from .base import ModelKind, Provider
from .fake import FakeProvider
from .ollama import OllamaLimits, OllamaProvider

# Add new vendors here (e.g. "openai"); select with KB_LLM_PROVIDER, or per task
# with KB_CHAT_PROVIDER / KB_EMBEDDING_PROVIDER.
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


@dataclass(frozen=True)
class Providers:
    """The provider serving each task; both are the same object when one
    provider serves chat and embeddings."""

    chat: Provider
    embedding: Provider

    @property
    def split(self) -> bool:
        return self.chat is not self.embedding

    async def aclose(self) -> None:
        await self.chat.aclose()
        if self.split:
            await self.embedding.aclose()


def build_provider(settings: Settings, name: str | None = None) -> Provider:
    """Builds the provider `name` (default KB_LLM_PROVIDER)."""
    name = name or settings.llm_provider
    try:
        factory = REGISTRY[name]
    except KeyError:
        raise ValueError(f"unknown llm provider {name!r}; known: {sorted(REGISTRY)}") from None
    return factory(settings)


def build_providers(settings: Settings) -> Providers:
    """Builds the chat and embedding providers, once if they are the same.
    Raises ValueError for a provider that lacks the task it is chosen for."""
    chat_name = settings.resolved_chat_provider
    embedding_name = settings.resolved_embedding_provider
    chat = build_provider(settings, chat_name)
    embedding = chat if embedding_name == chat_name else build_provider(settings, embedding_name)
    _require(chat, ModelKind.CHAT, "KB_CHAT_PROVIDER")
    _require(embedding, ModelKind.EMBEDDING, "KB_EMBEDDING_PROVIDER")
    return Providers(chat, embedding)


def _require(provider: Provider, kind: ModelKind, setting: str) -> None:
    default = (
        provider.default_chat_model if kind is ModelKind.CHAT else provider.default_embedding_model
    )
    if not default:
        raise ValueError(
            f"the {provider.name} provider has no {kind} models; set {setting} "
            f"to one that has (known providers: {sorted(REGISTRY)})"
        )
