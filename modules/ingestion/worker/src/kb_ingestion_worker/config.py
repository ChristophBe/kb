from typing import Self

from kb_platform.config import PlatformSettings
from pydantic import model_validator


class Settings(PlatformSettings):
    document_addr: str = "localhost:9001"
    llm_addr: str = "localhost:9004"
    # Chunks are measured in tokens of the embedding model's tokenizer: a name
    # bundled in kb_ingestion_worker/vocab (nomic-embed-text) or a path to a
    # Hugging Face tokenizer.json. Change it together with KB_EMBEDDING_MODEL
    # on the llm service.
    chunk_tokenizer: str = "nomic-embed-text"
    chunk_tokens: int = 256
    chunk_overlap_tokens: int = 32
    # Markdown sections shorter than this (tokens) merge with the next section
    # at the same level, so that a heading with a line of text isn't a chunk of its own.
    chunk_min_section_tokens: int = 50
    # Input limit of the embedding model in tokens, special tokens included.
    # Ollama runs nomic-embed-text with a 2048-token context.
    embedding_max_tokens: int = 2048
    embed_batch_size: int = 32
    # Deliveries of one upload before it fails for good. Transient errors (a peer
    # unavailable or overloaded) are retried after retry_delay seconds, doubling
    # up to retry_max_delay; other errors fail the document at once.
    max_deliver: int = 5
    retry_delay: float = 5
    retry_max_delay: float = 300

    @model_validator(mode="after")
    def _check_chunk_sizes(self) -> Self:
        if not 0 <= self.chunk_overlap_tokens < self.chunk_tokens:
            raise ValueError("KB_CHUNK_OVERLAP_TOKENS must be at least 0 and below KB_CHUNK_TOKENS")
        return self
