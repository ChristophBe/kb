from kb_platform.config import PlatformSettings
from pydantic import SecretStr


class Settings(PlatformSettings):
    grpc_port: int = 9004
    # Provider selection; see kb_llm.providers.REGISTRY.
    llm_provider: str = "ollama"
    ollama_url: str = "http://localhost:11434"
    chat_model: str = "llama3.2"
    embedding_model: str = "nomic-embed-text"
    # Anthropic (KB_LLM_PROVIDER=anthropic). Chat only: Anthropic has no embeddings.
    anthropic_api_key: SecretStr | None = None
    anthropic_chat_model: str = "claude-sonnet-5-5"
    # Upper bound for one answer when the caller sets none (the API requires one).
    anthropic_max_tokens: int = 16000
    # Seconds. Generous on purpose: a CPU-only Ollama can take minutes to load a model.
    provider_connect_timeout: float = 5
    provider_first_token_timeout: float = 120
    provider_generate_timeout: float = 600
    provider_embed_timeout: float = 120
    provider_list_timeout: float = 10
    # Attempts for idempotent calls (embed, list), doubling the delay after each.
    provider_attempts: int = 3
    provider_retry_delay: float = 0.5
    # Generate and Embed calls in flight per provider, above which calls are rejected.
    provider_max_concurrency: int = 8
    # Seconds the fake provider waits before each word; 0 streams at once.
    fake_token_delay: float = 0
    # Must match the vector column of the document module's chunk index.
    embedding_dimensions: int = 768
