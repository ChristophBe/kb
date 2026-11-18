from knowcel_platform.config import PlatformSettings, Problems


class Settings(PlatformSettings):
    grpc_port: int = 9005
    metrics_port: int = 9107
    # The Postgres database holding the curation schema (scores and findings),
    # as an SQLAlchemy URL.
    database_url: str = "postgresql+asyncpg://kb:kb@localhost:5432/kb"

    def check(self, problems: Problems) -> None:
        super().check(problems)
        problems.url("database_url", self.database_url, ["postgresql+asyncpg"])
