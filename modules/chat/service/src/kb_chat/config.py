from kb_platform.config import PlatformSettings


class Settings(PlatformSettings):
    grpc_port: int = 9003
    database_url: str = "postgresql+asyncpg://kb:kb@localhost:5432/kb"
    document_addr: str = "localhost:9001"
    llm_addr: str = "localhost:9004"
    # Number of chunks retrieved for grounding an answer.
    rag_top_k: int = 5
    # Number of previous messages sent to the model as context.
    history_limit: int = 20
