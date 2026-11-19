import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class LifecycleState(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    LIFECYCLE_STATE_UNSPECIFIED: _ClassVar[LifecycleState]
    LIFECYCLE_STATE_DRAFT: _ClassVar[LifecycleState]
    LIFECYCLE_STATE_IN_REVIEW: _ClassVar[LifecycleState]
    LIFECYCLE_STATE_APPROVED: _ClassVar[LifecycleState]
    LIFECYCLE_STATE_DEPRECATED: _ClassVar[LifecycleState]
    LIFECYCLE_STATE_ARCHIVED: _ClassVar[LifecycleState]

class FindingKind(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    FINDING_KIND_UNSPECIFIED: _ClassVar[FindingKind]
    FINDING_KIND_DUPLICATE: _ClassVar[FindingKind]
    FINDING_KIND_SUPERSEDED: _ClassVar[FindingKind]
    FINDING_KIND_CONFLICT: _ClassVar[FindingKind]
    FINDING_KIND_REVIEW_DUE: _ClassVar[FindingKind]
    FINDING_KIND_REPORTED: _ClassVar[FindingKind]

class Resolution(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    RESOLUTION_UNSPECIFIED: _ClassVar[Resolution]
    RESOLUTION_KEEP: _ClassVar[Resolution]
    RESOLUTION_REPLACE: _ClassVar[Resolution]
    RESOLUTION_IGNORE: _ClassVar[Resolution]
    RESOLUTION_DEPRECATE: _ClassVar[Resolution]

class ReportReason(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    REPORT_REASON_UNSPECIFIED: _ClassVar[ReportReason]
    REPORT_REASON_WRONG: _ClassVar[ReportReason]
    REPORT_REASON_OUTDATED: _ClassVar[ReportReason]
    REPORT_REASON_INAPPROPRIATE: _ClassVar[ReportReason]
    REPORT_REASON_OTHER: _ClassVar[ReportReason]

class Rating(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    RATING_UNSPECIFIED: _ClassVar[Rating]
    RATING_HELPFUL: _ClassVar[Rating]
    RATING_NOT_HELPFUL: _ClassVar[Rating]
    RATING_NONE: _ClassVar[Rating]
LIFECYCLE_STATE_UNSPECIFIED: LifecycleState
LIFECYCLE_STATE_DRAFT: LifecycleState
LIFECYCLE_STATE_IN_REVIEW: LifecycleState
LIFECYCLE_STATE_APPROVED: LifecycleState
LIFECYCLE_STATE_DEPRECATED: LifecycleState
LIFECYCLE_STATE_ARCHIVED: LifecycleState
FINDING_KIND_UNSPECIFIED: FindingKind
FINDING_KIND_DUPLICATE: FindingKind
FINDING_KIND_SUPERSEDED: FindingKind
FINDING_KIND_CONFLICT: FindingKind
FINDING_KIND_REVIEW_DUE: FindingKind
FINDING_KIND_REPORTED: FindingKind
RESOLUTION_UNSPECIFIED: Resolution
RESOLUTION_KEEP: Resolution
RESOLUTION_REPLACE: Resolution
RESOLUTION_IGNORE: Resolution
RESOLUTION_DEPRECATE: Resolution
REPORT_REASON_UNSPECIFIED: ReportReason
REPORT_REASON_WRONG: ReportReason
REPORT_REASON_OUTDATED: ReportReason
REPORT_REASON_INAPPROPRIATE: ReportReason
REPORT_REASON_OTHER: ReportReason
RATING_UNSPECIFIED: Rating
RATING_HELPFUL: Rating
RATING_NOT_HELPFUL: Rating
RATING_NONE: Rating

class DocumentScore(_message.Message):
    __slots__ = ("document_id", "score", "updated_at", "lifecycle", "excluded", "replaced")
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    SCORE_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    LIFECYCLE_FIELD_NUMBER: _ClassVar[int]
    EXCLUDED_FIELD_NUMBER: _ClassVar[int]
    REPLACED_FIELD_NUMBER: _ClassVar[int]
    document_id: str
    score: float
    updated_at: _timestamp_pb2.Timestamp
    lifecycle: Lifecycle
    excluded: bool
    replaced: bool
    def __init__(self, document_id: _Optional[str] = ..., score: _Optional[float] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., lifecycle: _Optional[_Union[Lifecycle, _Mapping]] = ..., excluded: _Optional[bool] = ..., replaced: _Optional[bool] = ...) -> None: ...

class Lifecycle(_message.Message):
    __slots__ = ("state", "owner", "review_by")
    STATE_FIELD_NUMBER: _ClassVar[int]
    OWNER_FIELD_NUMBER: _ClassVar[int]
    REVIEW_BY_FIELD_NUMBER: _ClassVar[int]
    state: LifecycleState
    owner: str
    review_by: _timestamp_pb2.Timestamp
    def __init__(self, state: _Optional[_Union[LifecycleState, str]] = ..., owner: _Optional[str] = ..., review_by: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class LifecycleChange(_message.Message):
    __slots__ = ("lifecycle", "note", "changed_by", "changed_at")
    LIFECYCLE_FIELD_NUMBER: _ClassVar[int]
    NOTE_FIELD_NUMBER: _ClassVar[int]
    CHANGED_BY_FIELD_NUMBER: _ClassVar[int]
    CHANGED_AT_FIELD_NUMBER: _ClassVar[int]
    lifecycle: Lifecycle
    note: str
    changed_by: str
    changed_at: _timestamp_pb2.Timestamp
    def __init__(self, lifecycle: _Optional[_Union[Lifecycle, _Mapping]] = ..., note: _Optional[str] = ..., changed_by: _Optional[str] = ..., changed_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class ResolutionOption(_message.Message):
    __slots__ = ("resolution", "description")
    RESOLUTION_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    resolution: Resolution
    description: str
    def __init__(self, resolution: _Optional[_Union[Resolution, str]] = ..., description: _Optional[str] = ...) -> None: ...

class Finding(_message.Message):
    __slots__ = ("id", "kind", "document_id", "other_document_id", "created_at", "summary", "document_title", "other_document_title", "resolutions", "reports", "report_count")
    ID_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    OTHER_DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    SUMMARY_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_TITLE_FIELD_NUMBER: _ClassVar[int]
    OTHER_DOCUMENT_TITLE_FIELD_NUMBER: _ClassVar[int]
    RESOLUTIONS_FIELD_NUMBER: _ClassVar[int]
    REPORTS_FIELD_NUMBER: _ClassVar[int]
    REPORT_COUNT_FIELD_NUMBER: _ClassVar[int]
    id: str
    kind: FindingKind
    document_id: str
    other_document_id: str
    created_at: _timestamp_pb2.Timestamp
    summary: str
    document_title: str
    other_document_title: str
    resolutions: _containers.RepeatedCompositeFieldContainer[ResolutionOption]
    reports: _containers.RepeatedCompositeFieldContainer[Report]
    report_count: int
    def __init__(self, id: _Optional[str] = ..., kind: _Optional[_Union[FindingKind, str]] = ..., document_id: _Optional[str] = ..., other_document_id: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., summary: _Optional[str] = ..., document_title: _Optional[str] = ..., other_document_title: _Optional[str] = ..., resolutions: _Optional[_Iterable[_Union[ResolutionOption, _Mapping]]] = ..., reports: _Optional[_Iterable[_Union[Report, _Mapping]]] = ..., report_count: _Optional[int] = ...) -> None: ...

class Report(_message.Message):
    __slots__ = ("reporter", "reason", "comment", "created_at")
    REPORTER_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    COMMENT_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    reporter: str
    reason: ReportReason
    comment: str
    created_at: _timestamp_pb2.Timestamp
    def __init__(self, reporter: _Optional[str] = ..., reason: _Optional[_Union[ReportReason, str]] = ..., comment: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class GetDocumentScoreRequest(_message.Message):
    __slots__ = ("document_id",)
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    document_id: str
    def __init__(self, document_id: _Optional[str] = ...) -> None: ...

class GetDocumentScoreResponse(_message.Message):
    __slots__ = ("score",)
    SCORE_FIELD_NUMBER: _ClassVar[int]
    score: DocumentScore
    def __init__(self, score: _Optional[_Union[DocumentScore, _Mapping]] = ...) -> None: ...

class ScoreChunksRequest(_message.Message):
    __slots__ = ("document_ids",)
    DOCUMENT_IDS_FIELD_NUMBER: _ClassVar[int]
    document_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, document_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class ScoreChunksResponse(_message.Message):
    __slots__ = ("scores",)
    SCORES_FIELD_NUMBER: _ClassVar[int]
    scores: _containers.RepeatedCompositeFieldContainer[DocumentScore]
    def __init__(self, scores: _Optional[_Iterable[_Union[DocumentScore, _Mapping]]] = ...) -> None: ...

class SetLifecycleRequest(_message.Message):
    __slots__ = ("document_id", "state", "owner", "review_by", "note")
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    STATE_FIELD_NUMBER: _ClassVar[int]
    OWNER_FIELD_NUMBER: _ClassVar[int]
    REVIEW_BY_FIELD_NUMBER: _ClassVar[int]
    NOTE_FIELD_NUMBER: _ClassVar[int]
    document_id: str
    state: LifecycleState
    owner: str
    review_by: _timestamp_pb2.Timestamp
    note: str
    def __init__(self, document_id: _Optional[str] = ..., state: _Optional[_Union[LifecycleState, str]] = ..., owner: _Optional[str] = ..., review_by: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., note: _Optional[str] = ...) -> None: ...

class SetLifecycleResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class ListLifecycleHistoryRequest(_message.Message):
    __slots__ = ("document_id",)
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    document_id: str
    def __init__(self, document_id: _Optional[str] = ...) -> None: ...

class ListLifecycleHistoryResponse(_message.Message):
    __slots__ = ("changes",)
    CHANGES_FIELD_NUMBER: _ClassVar[int]
    changes: _containers.RepeatedCompositeFieldContainer[LifecycleChange]
    def __init__(self, changes: _Optional[_Iterable[_Union[LifecycleChange, _Mapping]]] = ...) -> None: ...

class ReportDocumentRequest(_message.Message):
    __slots__ = ("document_id", "reason", "comment")
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    COMMENT_FIELD_NUMBER: _ClassVar[int]
    document_id: str
    reason: ReportReason
    comment: str
    def __init__(self, document_id: _Optional[str] = ..., reason: _Optional[_Union[ReportReason, str]] = ..., comment: _Optional[str] = ...) -> None: ...

class ReportDocumentResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class ListReportsRequest(_message.Message):
    __slots__ = ("document_id",)
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    document_id: str
    def __init__(self, document_id: _Optional[str] = ...) -> None: ...

class ListReportsResponse(_message.Message):
    __slots__ = ("reports",)
    REPORTS_FIELD_NUMBER: _ClassVar[int]
    reports: _containers.RepeatedCompositeFieldContainer[Report]
    def __init__(self, reports: _Optional[_Iterable[_Union[Report, _Mapping]]] = ...) -> None: ...

class RateDocumentRequest(_message.Message):
    __slots__ = ("document_id", "chunk_index", "rating", "conversation_id")
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    CHUNK_INDEX_FIELD_NUMBER: _ClassVar[int]
    RATING_FIELD_NUMBER: _ClassVar[int]
    CONVERSATION_ID_FIELD_NUMBER: _ClassVar[int]
    document_id: str
    chunk_index: int
    rating: Rating
    conversation_id: str
    def __init__(self, document_id: _Optional[str] = ..., chunk_index: _Optional[int] = ..., rating: _Optional[_Union[Rating, str]] = ..., conversation_id: _Optional[str] = ...) -> None: ...

class RateDocumentResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class GetRatingSummaryRequest(_message.Message):
    __slots__ = ("document_id", "chunk_index")
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    CHUNK_INDEX_FIELD_NUMBER: _ClassVar[int]
    document_id: str
    chunk_index: int
    def __init__(self, document_id: _Optional[str] = ..., chunk_index: _Optional[int] = ...) -> None: ...

class GetRatingSummaryResponse(_message.Message):
    __slots__ = ("helpful", "not_helpful", "my_rating")
    HELPFUL_FIELD_NUMBER: _ClassVar[int]
    NOT_HELPFUL_FIELD_NUMBER: _ClassVar[int]
    MY_RATING_FIELD_NUMBER: _ClassVar[int]
    helpful: int
    not_helpful: int
    my_rating: Rating
    def __init__(self, helpful: _Optional[int] = ..., not_helpful: _Optional[int] = ..., my_rating: _Optional[_Union[Rating, str]] = ...) -> None: ...

class ListFindingsRequest(_message.Message):
    __slots__ = ("page_size", "page_token", "kinds")
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    KINDS_FIELD_NUMBER: _ClassVar[int]
    page_size: int
    page_token: str
    kinds: _containers.RepeatedScalarFieldContainer[FindingKind]
    def __init__(self, page_size: _Optional[int] = ..., page_token: _Optional[str] = ..., kinds: _Optional[_Iterable[_Union[FindingKind, str]]] = ...) -> None: ...

class ResolveFindingRequest(_message.Message):
    __slots__ = ("finding_id", "resolution")
    FINDING_ID_FIELD_NUMBER: _ClassVar[int]
    RESOLUTION_FIELD_NUMBER: _ClassVar[int]
    finding_id: str
    resolution: Resolution
    def __init__(self, finding_id: _Optional[str] = ..., resolution: _Optional[_Union[Resolution, str]] = ...) -> None: ...

class ResolveFindingResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class ListFindingsResponse(_message.Message):
    __slots__ = ("findings", "next_page_token")
    FINDINGS_FIELD_NUMBER: _ClassVar[int]
    NEXT_PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    findings: _containers.RepeatedCompositeFieldContainer[Finding]
    next_page_token: str
    def __init__(self, findings: _Optional[_Iterable[_Union[Finding, _Mapping]]] = ..., next_page_token: _Optional[str] = ...) -> None: ...
