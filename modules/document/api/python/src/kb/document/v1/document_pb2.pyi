import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from kb.common.v1 import common_pb2 as _common_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class DocumentStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    DOCUMENT_STATUS_UNSPECIFIED: _ClassVar[DocumentStatus]
    DOCUMENT_STATUS_PENDING_UPLOAD: _ClassVar[DocumentStatus]
    DOCUMENT_STATUS_UPLOADED: _ClassVar[DocumentStatus]
    DOCUMENT_STATUS_PROCESSING: _ClassVar[DocumentStatus]
    DOCUMENT_STATUS_READY: _ClassVar[DocumentStatus]
    DOCUMENT_STATUS_FAILED: _ClassVar[DocumentStatus]
DOCUMENT_STATUS_UNSPECIFIED: DocumentStatus
DOCUMENT_STATUS_PENDING_UPLOAD: DocumentStatus
DOCUMENT_STATUS_UPLOADED: DocumentStatus
DOCUMENT_STATUS_PROCESSING: DocumentStatus
DOCUMENT_STATUS_READY: DocumentStatus
DOCUMENT_STATUS_FAILED: DocumentStatus

class Document(_message.Message):
    __slots__ = ("id", "title", "filename", "content_type", "size_bytes", "status", "status_detail", "chunk_count", "metadata", "create_time", "update_time", "owner_id", "sha256")
    class MetadataEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    ID_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    STATUS_DETAIL_FIELD_NUMBER: _ClassVar[int]
    CHUNK_COUNT_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    CREATE_TIME_FIELD_NUMBER: _ClassVar[int]
    UPDATE_TIME_FIELD_NUMBER: _ClassVar[int]
    OWNER_ID_FIELD_NUMBER: _ClassVar[int]
    SHA256_FIELD_NUMBER: _ClassVar[int]
    id: str
    title: str
    filename: str
    content_type: str
    size_bytes: int
    status: DocumentStatus
    status_detail: str
    chunk_count: int
    metadata: _containers.ScalarMap[str, str]
    create_time: _timestamp_pb2.Timestamp
    update_time: _timestamp_pb2.Timestamp
    owner_id: str
    sha256: str
    def __init__(self, id: _Optional[str] = ..., title: _Optional[str] = ..., filename: _Optional[str] = ..., content_type: _Optional[str] = ..., size_bytes: _Optional[int] = ..., status: _Optional[_Union[DocumentStatus, str]] = ..., status_detail: _Optional[str] = ..., chunk_count: _Optional[int] = ..., metadata: _Optional[_Mapping[str, str]] = ..., create_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., update_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., owner_id: _Optional[str] = ..., sha256: _Optional[str] = ...) -> None: ...

class Chunk(_message.Message):
    __slots__ = ("document_id", "index", "text", "metadata")
    class MetadataEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    INDEX_FIELD_NUMBER: _ClassVar[int]
    TEXT_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    document_id: str
    index: int
    text: str
    metadata: _containers.ScalarMap[str, str]
    def __init__(self, document_id: _Optional[str] = ..., index: _Optional[int] = ..., text: _Optional[str] = ..., metadata: _Optional[_Mapping[str, str]] = ...) -> None: ...

class ScoredChunk(_message.Message):
    __slots__ = ("chunk", "document_title", "score")
    CHUNK_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_TITLE_FIELD_NUMBER: _ClassVar[int]
    SCORE_FIELD_NUMBER: _ClassVar[int]
    chunk: Chunk
    document_title: str
    score: float
    def __init__(self, chunk: _Optional[_Union[Chunk, _Mapping]] = ..., document_title: _Optional[str] = ..., score: _Optional[float] = ...) -> None: ...

class ScoredDocument(_message.Message):
    __slots__ = ("document_id", "title", "score", "best_chunk")
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    SCORE_FIELD_NUMBER: _ClassVar[int]
    BEST_CHUNK_FIELD_NUMBER: _ClassVar[int]
    document_id: str
    title: str
    score: float
    best_chunk: Chunk
    def __init__(self, document_id: _Optional[str] = ..., title: _Optional[str] = ..., score: _Optional[float] = ..., best_chunk: _Optional[_Union[Chunk, _Mapping]] = ...) -> None: ...

class CreateDocumentRequest(_message.Message):
    __slots__ = ("title", "filename", "content_type", "size_bytes", "metadata", "sha256")
    class MetadataEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    TITLE_FIELD_NUMBER: _ClassVar[int]
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    SHA256_FIELD_NUMBER: _ClassVar[int]
    title: str
    filename: str
    content_type: str
    size_bytes: int
    metadata: _containers.ScalarMap[str, str]
    sha256: str
    def __init__(self, title: _Optional[str] = ..., filename: _Optional[str] = ..., content_type: _Optional[str] = ..., size_bytes: _Optional[int] = ..., metadata: _Optional[_Mapping[str, str]] = ..., sha256: _Optional[str] = ...) -> None: ...

class CreateDocumentResponse(_message.Message):
    __slots__ = ("document", "upload_url")
    DOCUMENT_FIELD_NUMBER: _ClassVar[int]
    UPLOAD_URL_FIELD_NUMBER: _ClassVar[int]
    document: Document
    upload_url: str
    def __init__(self, document: _Optional[_Union[Document, _Mapping]] = ..., upload_url: _Optional[str] = ...) -> None: ...

class GetDocumentRequest(_message.Message):
    __slots__ = ("id",)
    ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    def __init__(self, id: _Optional[str] = ...) -> None: ...

class GetDocumentResponse(_message.Message):
    __slots__ = ("document",)
    DOCUMENT_FIELD_NUMBER: _ClassVar[int]
    document: Document
    def __init__(self, document: _Optional[_Union[Document, _Mapping]] = ...) -> None: ...

class ListDocumentsRequest(_message.Message):
    __slots__ = ("page",)
    PAGE_FIELD_NUMBER: _ClassVar[int]
    page: _common_pb2.PageRequest
    def __init__(self, page: _Optional[_Union[_common_pb2.PageRequest, _Mapping]] = ...) -> None: ...

class ListDocumentsResponse(_message.Message):
    __slots__ = ("documents", "page")
    DOCUMENTS_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    documents: _containers.RepeatedCompositeFieldContainer[Document]
    page: _common_pb2.PageResponse
    def __init__(self, documents: _Optional[_Iterable[_Union[Document, _Mapping]]] = ..., page: _Optional[_Union[_common_pb2.PageResponse, _Mapping]] = ...) -> None: ...

class UpdateDocumentRequest(_message.Message):
    __slots__ = ("id", "title", "metadata", "set_metadata")
    class MetadataEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    ID_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    SET_METADATA_FIELD_NUMBER: _ClassVar[int]
    id: str
    title: str
    metadata: _containers.ScalarMap[str, str]
    set_metadata: bool
    def __init__(self, id: _Optional[str] = ..., title: _Optional[str] = ..., metadata: _Optional[_Mapping[str, str]] = ..., set_metadata: _Optional[bool] = ...) -> None: ...

class UpdateDocumentResponse(_message.Message):
    __slots__ = ("document",)
    DOCUMENT_FIELD_NUMBER: _ClassVar[int]
    document: Document
    def __init__(self, document: _Optional[_Union[Document, _Mapping]] = ...) -> None: ...

class DeleteDocumentRequest(_message.Message):
    __slots__ = ("id",)
    ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    def __init__(self, id: _Optional[str] = ...) -> None: ...

class DeleteDocumentResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class SetDocumentStatusRequest(_message.Message):
    __slots__ = ("id", "status", "status_detail")
    ID_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    STATUS_DETAIL_FIELD_NUMBER: _ClassVar[int]
    id: str
    status: DocumentStatus
    status_detail: str
    def __init__(self, id: _Optional[str] = ..., status: _Optional[_Union[DocumentStatus, str]] = ..., status_detail: _Optional[str] = ...) -> None: ...

class SetDocumentStatusResponse(_message.Message):
    __slots__ = ("document",)
    DOCUMENT_FIELD_NUMBER: _ClassVar[int]
    document: Document
    def __init__(self, document: _Optional[_Union[Document, _Mapping]] = ...) -> None: ...

class GetDownloadUrlRequest(_message.Message):
    __slots__ = ("id",)
    ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    def __init__(self, id: _Optional[str] = ...) -> None: ...

class GetDownloadUrlResponse(_message.Message):
    __slots__ = ("url",)
    URL_FIELD_NUMBER: _ClassVar[int]
    url: str
    def __init__(self, url: _Optional[str] = ...) -> None: ...

class ReadContentRequest(_message.Message):
    __slots__ = ("id",)
    ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    def __init__(self, id: _Optional[str] = ...) -> None: ...

class ReadContentResponse(_message.Message):
    __slots__ = ("data",)
    DATA_FIELD_NUMBER: _ClassVar[int]
    data: bytes
    def __init__(self, data: _Optional[bytes] = ...) -> None: ...

class ChunkInput(_message.Message):
    __slots__ = ("index", "text", "embedding", "metadata")
    class MetadataEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    INDEX_FIELD_NUMBER: _ClassVar[int]
    TEXT_FIELD_NUMBER: _ClassVar[int]
    EMBEDDING_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    index: int
    text: str
    embedding: _containers.RepeatedScalarFieldContainer[float]
    metadata: _containers.ScalarMap[str, str]
    def __init__(self, index: _Optional[int] = ..., text: _Optional[str] = ..., embedding: _Optional[_Iterable[float]] = ..., metadata: _Optional[_Mapping[str, str]] = ...) -> None: ...

class AddChunksRequest(_message.Message):
    __slots__ = ("document_id", "chunks")
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    CHUNKS_FIELD_NUMBER: _ClassVar[int]
    document_id: str
    chunks: _containers.RepeatedCompositeFieldContainer[ChunkInput]
    def __init__(self, document_id: _Optional[str] = ..., chunks: _Optional[_Iterable[_Union[ChunkInput, _Mapping]]] = ...) -> None: ...

class AddChunksResponse(_message.Message):
    __slots__ = ("chunk_count",)
    CHUNK_COUNT_FIELD_NUMBER: _ClassVar[int]
    chunk_count: int
    def __init__(self, chunk_count: _Optional[int] = ...) -> None: ...

class ListChunksRequest(_message.Message):
    __slots__ = ("document_id", "page")
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    document_id: str
    page: _common_pb2.PageRequest
    def __init__(self, document_id: _Optional[str] = ..., page: _Optional[_Union[_common_pb2.PageRequest, _Mapping]] = ...) -> None: ...

class ListChunksResponse(_message.Message):
    __slots__ = ("chunks", "page")
    CHUNKS_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    chunks: _containers.RepeatedCompositeFieldContainer[Chunk]
    page: _common_pb2.PageResponse
    def __init__(self, chunks: _Optional[_Iterable[_Union[Chunk, _Mapping]]] = ..., page: _Optional[_Union[_common_pb2.PageResponse, _Mapping]] = ...) -> None: ...

class SearchChunksRequest(_message.Message):
    __slots__ = ("embedding", "limit", "document_ids")
    EMBEDDING_FIELD_NUMBER: _ClassVar[int]
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_IDS_FIELD_NUMBER: _ClassVar[int]
    embedding: _containers.RepeatedScalarFieldContainer[float]
    limit: int
    document_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, embedding: _Optional[_Iterable[float]] = ..., limit: _Optional[int] = ..., document_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class SearchChunksResponse(_message.Message):
    __slots__ = ("results",)
    RESULTS_FIELD_NUMBER: _ClassVar[int]
    results: _containers.RepeatedCompositeFieldContainer[ScoredChunk]
    def __init__(self, results: _Optional[_Iterable[_Union[ScoredChunk, _Mapping]]] = ...) -> None: ...

class SearchDocumentsRequest(_message.Message):
    __slots__ = ("query", "limit", "document_ids")
    QUERY_FIELD_NUMBER: _ClassVar[int]
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_IDS_FIELD_NUMBER: _ClassVar[int]
    query: str
    limit: int
    document_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, query: _Optional[str] = ..., limit: _Optional[int] = ..., document_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class SearchDocumentsResponse(_message.Message):
    __slots__ = ("results", "documents")
    RESULTS_FIELD_NUMBER: _ClassVar[int]
    DOCUMENTS_FIELD_NUMBER: _ClassVar[int]
    results: _containers.RepeatedCompositeFieldContainer[ScoredChunk]
    documents: _containers.RepeatedCompositeFieldContainer[ScoredDocument]
    def __init__(self, results: _Optional[_Iterable[_Union[ScoredChunk, _Mapping]]] = ..., documents: _Optional[_Iterable[_Union[ScoredDocument, _Mapping]]] = ...) -> None: ...
