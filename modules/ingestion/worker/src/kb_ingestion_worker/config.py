from kb_platform.config import PlatformSettings


class Settings(PlatformSettings):
    document_addr: str = "localhost:9001"
    llm_addr: str = "localhost:9004"
    chunk_size: int = 1000
    chunk_overlap: int = 150
    embed_batch_size: int = 32
