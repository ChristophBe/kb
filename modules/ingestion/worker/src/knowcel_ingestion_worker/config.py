from knowcel_platform.config import PlatformSettings, Problems
from pydantic import Field

from .tokens import TokenizerNotFoundError
from .tokens import load as load_tokenizer


class Settings(PlatformSettings):
    metrics_port: int = 9105
    # The document module (host:port), whose documents the worker reads and fills.
    document_addr: str = "localhost:9001"
    # The llm module (host:port), which embeds the chunks.
    llm_addr: str = "localhost:9004"
    # Chunks are measured in tokens of the embedding model's tokenizer: a name
    # bundled in knowcel_ingestion_worker/vocab (nomic-embed-text) or a path to a
    # Hugging Face tokenizer.json. Change it together with KB_EMBEDDING_MODEL
    # on the llm service.
    chunk_tokenizer: str = "nomic-embed-text"
    # Size of a chunk in tokens; it must fit KB_EMBEDDING_MAX_TOKENS.
    chunk_tokens: int = 256
    # Tokens a chunk repeats from the end of the previous one, below KB_CHUNK_TOKENS.
    chunk_overlap_tokens: int = 32
    # Markdown sections shorter than this (tokens) merge with the next section
    # at the same level, so that a heading with a line of text isn't a chunk of its own.
    chunk_min_section_tokens: int = 50
    # Input limit of the embedding model in tokens, special tokens included.
    # Ollama runs nomic-embed-text with a 2048-token context.
    embedding_max_tokens: int = 2048
    # Chunks sent to the llm module per Embed call.
    embed_batch_size: int = 32
    # Deliveries of one upload before it fails for good. Transient errors (a peer
    # unavailable or overloaded) are retried, other errors fail the document at once.
    max_deliver: int = 5
    # Seconds before the first retry of a transient error; doubles with each retry.
    retry_delay: float = 5
    # Seconds the delay between retries grows to at most.
    retry_max_delay: float = 300
    # Uploads processed at the same time. 2 overlaps one document's download,
    # extraction and storing with another's embedding without piling requests
    # on a single local embedding model, which works through them one by one
    # anyway on CPU. Raise it when the embedding backend runs requests in
    # parallel (a GPU, a hosted provider, Ollama with OLLAMA_NUM_PARALLEL).
    worker_concurrency: int = Field(default=2, ge=1)

    def check(self, problems: Problems) -> None:
        super().check(problems)
        problems.addr("document_addr", self.document_addr)
        problems.addr("llm_addr", self.llm_addr)
        problems.at_least("chunk_tokens", self.chunk_tokens, 1)
        if not 0 <= self.chunk_overlap_tokens < self.chunk_tokens:
            problems.add(
                "chunk_overlap_tokens",
                f"must be at least 0 and below KB_CHUNK_TOKENS ({self.chunk_tokens}), "
                f"got {self.chunk_overlap_tokens}",
            )
        problems.at_least("chunk_min_section_tokens", self.chunk_min_section_tokens, 0)
        try:
            special = load_tokenizer(self.chunk_tokenizer).special_tokens
        except TokenizerNotFoundError as exc:
            problems.add("chunk_tokenizer", str(exc))
        else:
            # Processor enforces the same limit for settings built in code.
            if self.chunk_tokens > self.embedding_max_tokens - special:
                problems.add(
                    "chunk_tokens",
                    f"{self.chunk_tokens} exceeds the embedding model's input limit of "
                    f"{self.embedding_max_tokens - special} tokens (KB_EMBEDDING_MAX_TOKENS "
                    f"{self.embedding_max_tokens} minus {special} special tokens)",
                )
        problems.at_least("embed_batch_size", self.embed_batch_size, 1)
        problems.at_least("max_deliver", self.max_deliver, 1)
        problems.at_least("retry_delay", self.retry_delay, 0)
        if self.retry_max_delay < self.retry_delay:
            problems.add(
                "retry_max_delay",
                f"must be at least KB_RETRY_DELAY ({self.retry_delay}), got {self.retry_max_delay}",
            )
