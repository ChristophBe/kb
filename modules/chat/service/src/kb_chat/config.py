from pathlib import Path

from kb_platform.config import PlatformSettings

# The repository root, also in the image (/app): the package is installed editable.
_ROOT = Path(__file__).resolve().parents[5]


class Settings(PlatformSettings):
    grpc_port: int = 9003
    database_url: str = "postgresql+asyncpg://kb:kb@localhost:5432/kb"
    document_addr: str = "localhost:9001"
    llm_addr: str = "localhost:9004"
    # Number of chunks retrieved for grounding an answer, and the cosine
    # similarity a chunk needs to count as related to the question. Measured with
    # nomic-embed-text: the passage answering a question scores about 0.67-0.84,
    # the best chunk for an unrelated question at most 0.44. Tune it together
    # with the embedding model.
    rag_top_k: int = 5
    rag_min_score: float = 0.5
    # Previous messages loaded as context; the token budget below may drop the oldest.
    history_limit: int = 20
    # Context window of the chat model in tokens, and the part of it kept free for
    # the answer. The prompt (instructions, sources, history, question) gets the rest.
    # 4096 is Ollama's default window; raise it together with the model's num_ctx.
    context_tokens: int = 4096
    answer_reserve_tokens: int = 1024
    # The user manual chat answers how-to questions from, and how many of its
    # sections an answer may cite on top of the document passages. A section
    # needs a cosine similarity of at least manual_min_score: with
    # nomic-embed-text, how-to questions score about 0.7-0.8 and unrelated ones
    # below 0.56.
    manual_dir: Path = _ROOT / "docs" / "user-manual"
    manual_top_k: int = 2
    manual_min_score: float = 0.65
