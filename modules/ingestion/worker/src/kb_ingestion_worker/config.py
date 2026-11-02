from kb_platform.config import PlatformSettings


class Settings(PlatformSettings):
    document_addr: str = "localhost:9001"
    llm_addr: str = "localhost:9004"
    chunk_size: int = 1000
    chunk_overlap: int = 150
    # Markdown sections shorter than this (characters) merge with the next section
    # at the same level, so that a heading with a line of text isn't a chunk of its own.
    chunk_min_section_size: int = 200
    embed_batch_size: int = 32
