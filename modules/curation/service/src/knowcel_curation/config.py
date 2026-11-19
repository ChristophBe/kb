from knowcel_platform.config import PlatformSettings, Problems

from .curation import Weights
from .findings import Thresholds


class Settings(PlatformSettings):
    grpc_port: int = 9005
    metrics_port: int = 9107
    # The Postgres database holding the curation schema (scores and findings),
    # as an SQLAlchemy URL.
    database_url: str = "postgresql+asyncpg://kb:kb@localhost:5432/kb"
    # The iam module (host:port), which tells whether a caller is a team admin or
    # platform admin of a document. While it is down, only a document's owner
    # can change its lifecycle.
    iam_addr: str = "localhost:9006"
    # The document module (host:port), which tells which documents a caller can
    # see. While it is down, scores can't be read (UNAVAILABLE).
    document_addr: str = "localhost:9001"
    # Weight of a document's recency in its score. Only the ratio to the usage
    # weight matters.
    curation_recency_weight: float = 1.0
    # Weight of how often chat cites a document. 0 until chat reports its
    # citations; a score then comes from recency and replacements alone.
    curation_usage_weight: float = 0.0
    # Days after which the recency of a document has halved.
    curation_half_life_days: float = 180
    # The llm module (host:port), which embeds passages and judges whether two
    # contradict each other. While it is down, new documents are not checked
    # for findings until it is back.
    llm_addr: str = "localhost:9004"
    # Cosine similarity at which a passage counts as a copy of another.
    curation_duplicate_threshold: float = 0.97
    # Cosine similarity at which a passage counts as part of another version of
    # the same text.
    curation_version_threshold: float = 0.85
    # Cosine similarity from which two passages are asked about whether they
    # contradict each other.
    curation_conflict_threshold: float = 0.75
    # Passages of a new document compared with the other documents.
    curation_sample_chunks: int = 5
    # Pairs of passages per new document the chat model is asked about; 0 turns
    # conflict detection off.
    curation_conflict_checks: int = 3
    # Seconds between scoring all documents again, so that recency keeps
    # decaying while no document is processed. Documents past their review date
    # are opened as findings at the same time.
    curation_rescore_interval: float = 3600
    # Factor an approved document's score is multiplied by, at most up to 1.
    curation_approved_boost: float = 1.25
    # Factor a deprecated document's score is multiplied by, between 0 and 1.
    curation_deprecated_factor: float = 0.1
    # Factor an archived document's score is multiplied by, between 0 and 1.
    curation_archived_factor: float = 0.05
    # Factor a score is multiplied by for each document that replaces it, between 0 and 1.
    curation_replacement_penalty: float = 0.5
    # Citations at which the usage signal is at its maximum.
    curation_usage_saturation: int = 20

    def check(self, problems: Problems) -> None:
        super().check(problems)
        problems.url("database_url", self.database_url, ["postgresql+asyncpg"])
        problems.addr("iam_addr", self.iam_addr)
        problems.addr("document_addr", self.document_addr)
        problems.addr("llm_addr", self.llm_addr)
        problems.at_least("curation_recency_weight", self.curation_recency_weight, 0)
        problems.at_least("curation_usage_weight", self.curation_usage_weight, 0)
        if not self.curation_recency_weight + self.curation_usage_weight > 0:
            problems.add("curation_recency_weight", "the weights must not both be 0")
        if not self.curation_half_life_days > 0:
            problems.add(
                "curation_half_life_days", f"must be positive, got {self.curation_half_life_days}"
            )
        problems.between("curation_replacement_penalty", self.curation_replacement_penalty, 0, 1)
        problems.at_least("curation_approved_boost", self.curation_approved_boost, 1)
        problems.between("curation_deprecated_factor", self.curation_deprecated_factor, 0, 1)
        problems.between("curation_archived_factor", self.curation_archived_factor, 0, 1)
        problems.at_least("curation_rescore_interval", self.curation_rescore_interval, 1)
        problems.between("curation_conflict_threshold", self.curation_conflict_threshold, -1, 1)
        problems.between(
            "curation_version_threshold",
            self.curation_version_threshold,
            self.curation_conflict_threshold,
            1,
        )
        problems.between(
            "curation_duplicate_threshold",
            self.curation_duplicate_threshold,
            self.curation_version_threshold,
            1,
        )
        problems.at_least("curation_sample_chunks", self.curation_sample_chunks, 1)
        problems.at_least("curation_conflict_checks", self.curation_conflict_checks, 0)
        problems.at_least("curation_usage_saturation", self.curation_usage_saturation, 1)

    @property
    def thresholds(self) -> Thresholds:
        return Thresholds(
            duplicate=self.curation_duplicate_threshold,
            version=self.curation_version_threshold,
            conflict=self.curation_conflict_threshold,
            sample_chunks=self.curation_sample_chunks,
            conflict_checks=self.curation_conflict_checks,
        )

    @property
    def weights(self) -> Weights:
        return Weights(
            recency=self.curation_recency_weight,
            usage=self.curation_usage_weight,
            half_life_days=self.curation_half_life_days,
            replacement_penalty=self.curation_replacement_penalty,
            usage_saturation=self.curation_usage_saturation,
            approved_boost=self.curation_approved_boost,
            deprecated_factor=self.curation_deprecated_factor,
            archived_factor=self.curation_archived_factor,
        )
