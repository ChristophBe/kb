from pathlib import Path

from knowcel_platform.config import PlatformSettings, Problems

# The repository root, also in the image (/app): the package is installed editable.
_ROOT = Path(__file__).resolve().parents[5]


class Settings(PlatformSettings):
    grpc_port: int = 9003
    metrics_port: int = 9103
    # The Postgres database holding the chat schema, as an SQLAlchemy URL.
    database_url: str = "postgresql+asyncpg://kb:kb@localhost:5432/kb"
    # The document module (host:port), which retrieves the passages.
    document_addr: str = "localhost:9001"
    # The llm module (host:port), which embeds questions and generates answers.
    llm_addr: str = "localhost:9004"
    # The iam module (host:port), which tells the teams of a caller. While it is
    # down, conversations can't be limited to teams; everything else works.
    iam_addr: str = "localhost:9006"
    # The curation module (host:port), which scores the documents of retrieved
    # passages. While it is down, passages are ranked by similarity alone.
    curation_addr: str = "localhost:9005"
    # Use curation scores in retrieval: passages of documents that are replaced
    # by a newer one, deprecated or archived are left out, and the rest are
    # ranked down by their document's score. Off ranks by similarity alone.
    curation_enabled: bool = True
    # Seconds the curation module may take to answer before passages are ranked
    # by similarity alone.
    curation_timeout: float = 3
    # How far a document's curation score can rank its passages down, between 0
    # (not at all) and 1 (a score of 0 puts a passage at the end).
    curation_weight: float = 0.3
    # Number of chunks retrieved for grounding an answer.
    rag_top_k: int = 5
    # Cosine similarity (-1 to 1) a chunk needs to count as related to the
    # question. Measured with nomic-embed-text: the passage answering a question
    # scores about 0.67-0.84, the best chunk for an unrelated question at most
    # 0.44. Tune it together with the embedding model.
    rag_min_score: float = 0.5
    # Rerank the retrieved chunks with the llm module's chat model: more
    # candidates are fetched, rated against the question, and the best
    # KNOWCEL_RAG_TOP_K are kept. Costs one extra model call per question; if
    # it fails, the answer uses the similarity order.
    rerank_enabled: bool = True
    # Chunks fetched as candidates for reranking; at least KNOWCEL_RAG_TOP_K.
    rerank_candidates: int = 15
    # Model that rates the candidates; empty selects the llm module's default chat model.
    rerank_model: str = ""
    # Previous messages loaded as context; the token budget below may drop the oldest.
    history_limit: int = 20
    # Context window of the chat model in tokens. 4096 is Ollama's default
    # window; raise it together with the model's num_ctx.
    context_tokens: int = 4096
    # Tokens of the context window kept free for the answer. The prompt
    # (instructions, sources, history, question) gets the rest.
    answer_reserve_tokens: int = 1024
    # Directory of the user manual chat answers how-to questions from.
    manual_dir: Path = _ROOT / "docs" / "user-manual"
    # Manual sections an answer may cite on top of the document passages.
    manual_top_k: int = 2
    # Cosine similarity a manual section needs to be cited: with
    # nomic-embed-text, how-to questions score about 0.7-0.8 and unrelated ones
    # below 0.56.
    manual_min_score: float = 0.65

    def check(self, problems: Problems) -> None:
        super().check(problems)
        problems.url("database_url", self.database_url, ["postgresql+asyncpg"])
        problems.addr("document_addr", self.document_addr)
        problems.addr("llm_addr", self.llm_addr)
        problems.addr("iam_addr", self.iam_addr)
        problems.addr("curation_addr", self.curation_addr)
        problems.between("curation_weight", self.curation_weight, 0, 1)
        if not self.curation_timeout > 0:
            problems.add("curation_timeout", f"must be positive, got {self.curation_timeout}")
        problems.at_least("rag_top_k", self.rag_top_k, 1)
        problems.at_least("rerank_candidates", self.rerank_candidates, self.rag_top_k)
        problems.between("rag_min_score", self.rag_min_score, -1, 1)
        problems.at_least("history_limit", self.history_limit, 0)
        problems.at_least("answer_reserve_tokens", self.answer_reserve_tokens, 1)
        if self.context_tokens <= self.answer_reserve_tokens:
            problems.add(
                "context_tokens",
                f"must be above KNOWCEL_ANSWER_RESERVE_TOKENS ({self.answer_reserve_tokens}), "
                f"got {self.context_tokens}",
            )
        if not self.manual_dir.is_dir():
            problems.add("manual_dir", f"must be a directory, got {str(self.manual_dir)!r}")
        problems.at_least("manual_top_k", self.manual_top_k, 0)
        problems.between("manual_min_score", self.manual_min_score, -1, 1)
