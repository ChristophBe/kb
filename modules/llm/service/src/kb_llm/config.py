from kb_platform.config import PlatformSettings


class Settings(PlatformSettings):
    grpc_port: int = 9004
    # Provider selection; see kb_llm.providers.REGISTRY.
    llm_provider: str = "ollama"
    ollama_url: str = "http://localhost:11434"
    chat_model: str = "llama3.2"
    embedding_model: str = "nomic-embed-text"
    # Must match the vector column of the document module's chunk index.
    embedding_dimensions: int = 768
