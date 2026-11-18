from knowcel_platform.config import PlatformSettings, Problems


class Settings(PlatformSettings):
    grpc_port: int = 9005
    metrics_port: int = 9107
    # The Postgres database holding the curation schema (scores and findings),
    # as an SQLAlchemy URL.
    database_url: str = "postgresql+asyncpg://kb:kb@localhost:5432/kb"
    # The iam module (host:port), which tells which documents a caller can see.
    # While it is down, only the caller's own are covered.
    iam_addr: str = "localhost:9006"

    def check(self, problems: Problems) -> None:
        super().check(problems)
        problems.addr("iam_addr", self.iam_addr)
        problems.url("database_url", self.database_url, ["postgresql+asyncpg"])
