import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class FindingKind(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    FINDING_KIND_UNSPECIFIED: _ClassVar[FindingKind]
    FINDING_KIND_DUPLICATE: _ClassVar[FindingKind]
    FINDING_KIND_SUPERSEDED: _ClassVar[FindingKind]
    FINDING_KIND_CONFLICT: _ClassVar[FindingKind]

class Resolution(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    RESOLUTION_UNSPECIFIED: _ClassVar[Resolution]
    RESOLUTION_KEEP: _ClassVar[Resolution]
    RESOLUTION_REPLACE: _ClassVar[Resolution]
    RESOLUTION_IGNORE: _ClassVar[Resolution]
FINDING_KIND_UNSPECIFIED: FindingKind
FINDING_KIND_DUPLICATE: FindingKind
FINDING_KIND_SUPERSEDED: FindingKind
FINDING_KIND_CONFLICT: FindingKind
RESOLUTION_UNSPECIFIED: Resolution
RESOLUTION_KEEP: Resolution
RESOLUTION_REPLACE: Resolution
RESOLUTION_IGNORE: Resolution

class DocumentScore(_message.Message):
    __slots__ = ("document_id", "score", "updated_at")
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    SCORE_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    document_id: str
    score: float
    updated_at: _timestamp_pb2.Timestamp
    def __init__(self, document_id: _Optional[str] = ..., score: _Optional[float] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class ResolutionOption(_message.Message):
    __slots__ = ("resolution", "description")
    RESOLUTION_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    resolution: Resolution
    description: str
    def __init__(self, resolution: _Optional[_Union[Resolution, str]] = ..., description: _Optional[str] = ...) -> None: ...

class Finding(_message.Message):
    __slots__ = ("id", "kind", "document_id", "other_document_id", "created_at", "summary", "document_title", "other_document_title", "resolutions")
    ID_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    OTHER_DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    SUMMARY_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_TITLE_FIELD_NUMBER: _ClassVar[int]
    OTHER_DOCUMENT_TITLE_FIELD_NUMBER: _ClassVar[int]
    RESOLUTIONS_FIELD_NUMBER: _ClassVar[int]
    id: str
    kind: FindingKind
    document_id: str
    other_document_id: str
    created_at: _timestamp_pb2.Timestamp
    summary: str
    document_title: str
    other_document_title: str
    resolutions: _containers.RepeatedCompositeFieldContainer[ResolutionOption]
    def __init__(self, id: _Optional[str] = ..., kind: _Optional[_Union[FindingKind, str]] = ..., document_id: _Optional[str] = ..., other_document_id: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., summary: _Optional[str] = ..., document_title: _Optional[str] = ..., other_document_title: _Optional[str] = ..., resolutions: _Optional[_Iterable[_Union[ResolutionOption, _Mapping]]] = ...) -> None: ...

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

class ListFindingsRequest(_message.Message):
    __slots__ = ("page_size", "page_token")
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    page_size: int
    page_token: str
    def __init__(self, page_size: _Optional[int] = ..., page_token: _Optional[str] = ...) -> None: ...

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
