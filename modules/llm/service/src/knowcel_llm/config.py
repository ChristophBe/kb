from knowcel_platform.config import PlatformSettings, Problems
from pydantic import SecretStr


class Settings(PlatformSettings):
    grpc_port: int = 9004
    metrics_port: int = 9104
    # The iam module (host:port), which tells whether a caller is a platform
    # admin. While it is down, nobody is one and models can't be changed.
    iam_addr: str = "localhost:9006"
    # Provider for chat and embeddings, a name in knowcel_llm.providers.REGISTRY:
    # ollama, anthropic or fake.
    llm_provider: str = "ollama"
    # Provider for Generate (chat) only, e.g. anthropic with Ollama embeddings;
    # empty falls back to KNOWCEL_LLM_PROVIDER.
    chat_provider: str = ""
    # Provider for Embed only; empty falls back to KNOWCEL_LLM_PROVIDER.
    embedding_provider: str = ""
    # Ollama server (provider ollama).
    ollama_url: str = "http://localhost:11434"
    # Default chat model of the ollama provider.
    chat_model: str = "llama3.2"
    # Default embedding model of the ollama provider; change the ingestion
    # worker's KNOWCEL_CHUNK_TOKENIZER with it.
    embedding_model: str = "nomic-embed-text"
    # Anthropic API key, required by provider anthropic (chat only: Anthropic
    # has no embeddings).
    anthropic_api_key: SecretStr | None = None
    # Default chat model of the anthropic provider.
    anthropic_chat_model: str = "claude-sonnet-5-5"
    # Upper bound for one answer when the caller sets none (the API requires one).
    anthropic_max_tokens: int = 16000
    # Seconds to connect to a provider.
    provider_connect_timeout: float = 5
    # Seconds until the first token of an answer. Generous on purpose: a
    # CPU-only Ollama can take minutes to load a model.
    provider_first_token_timeout: float = 120
    # Seconds one whole answer may take.
    provider_generate_timeout: float = 600
    # Seconds one Embed call may take.
    provider_embed_timeout: float = 120
    # Seconds to list a provider's models or check its health.
    provider_list_timeout: float = 10
    # Seconds a model download may go without progress before it is given up.
    provider_pull_stall_timeout: float = 120
    # Attempts for idempotent calls (embed, list), doubling the delay after each.
    provider_attempts: int = 3
    # Seconds before the second attempt.
    provider_retry_delay: float = 0.5
    # Generate and Embed calls in flight per provider, above which calls are rejected.
    provider_max_concurrency: int = 8
    # Seconds the fake provider waits before each word; 0 streams at once.
    fake_token_delay: float = 0
    # The embedding model the fake provider reports (and hashes into its vectors).
    fake_embedding_model: str = "fake-embed"
    # Length of the embedding vectors. Must match the vector column of the
    # document module's chunk index, which checks it at startup.
    embedding_dimensions: int = 768

    @property
    def resolved_chat_provider(self) -> str:
        return self.chat_provider or self.llm_provider

    @property
    def resolved_embedding_provider(self) -> str:
        return self.embedding_provider or self.llm_provider

    def check(self, problems: Problems) -> None:
        super().check(problems)
        problems.addr("iam_addr", self.iam_addr)
        # Imported here: the providers import these settings.
        from .providers import REGISTRY

        for field in ("llm_provider", "chat_provider", "embedding_provider"):
            name = getattr(self, field)
            if (name or field == "llm_provider") and name not in REGISTRY:
                problems.one_of(field, name, sorted(REGISTRY))
        resolved = (self.resolved_chat_provider, self.resolved_embedding_provider)
        if "anthropic" in resolved and not (
            self.anthropic_api_key and self.anthropic_api_key.get_secret_value()
        ):
            problems.add("anthropic_api_key", "must be set for the anthropic provider")
        if "ollama" in resolved:
            problems.url("ollama_url", self.ollama_url, ["http", "https"])
        problems.at_least("anthropic_max_tokens", self.anthropic_max_tokens, 1)
        for field in (
            "provider_connect_timeout",
            "provider_first_token_timeout",
            "provider_generate_timeout",
            "provider_embed_timeout",
            "provider_list_timeout",
            "provider_pull_stall_timeout",
        ):
            if not getattr(self, field) > 0:
                problems.add(field, f"must be positive, got {getattr(self, field)}")
        problems.at_least("provider_attempts", self.provider_attempts, 1)
        problems.at_least("provider_retry_delay", self.provider_retry_delay, 0)
        problems.at_least("provider_max_concurrency", self.provider_max_concurrency, 1)
        problems.at_least("fake_token_delay", self.fake_token_delay, 0)
        # pgvector indexes (hnsw) take up to 2000 dimensions.
        problems.between("embedding_dimensions", self.embedding_dimensions, 1, 2000)
