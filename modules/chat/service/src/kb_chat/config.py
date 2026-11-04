from kb_platform.config import PlatformSettings


class Settings(PlatformSettings):
    grpc_port: int = 9003
    database_url: str = "postgresql+asyncpg://kb:kb@localhost:5432/kb"
    document_addr: str = "localhost:9001"
    llm_addr: str = "localhost:9004"
    # Number of chunks retrieved for grounding an answer.
    rag_top_k: int = 5
    # Previous messages loaded as context; the token budget below may drop the oldest.
    history_limit: int = 20
    # Context window of the chat model in tokens, and the part of it kept free for
    # the answer. The prompt (instructions, sources, history, question) gets the rest.
    # 4096 is Ollama's default window; raise it together with the model's num_ctx.
    context_tokens: int = 4096
    answer_reserve_tokens: int = 1024
