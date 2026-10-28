from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class DocumentUploaded(_message.Message):
    __slots__ = ("job_id", "document_id", "filename", "content_type")
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    document_id: str
    filename: str
    content_type: str
    def __init__(self, job_id: _Optional[str] = ..., document_id: _Optional[str] = ..., filename: _Optional[str] = ..., content_type: _Optional[str] = ...) -> None: ...

class ProcessingStarted(_message.Message):
    __slots__ = ("job_id", "document_id")
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    document_id: str
    def __init__(self, job_id: _Optional[str] = ..., document_id: _Optional[str] = ...) -> None: ...

class DocumentProcessed(_message.Message):
    __slots__ = ("job_id", "document_id", "chunk_count")
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    CHUNK_COUNT_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    document_id: str
    chunk_count: int
    def __init__(self, job_id: _Optional[str] = ..., document_id: _Optional[str] = ..., chunk_count: _Optional[int] = ...) -> None: ...

class ProcessingFailed(_message.Message):
    __slots__ = ("job_id", "document_id", "error")
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    document_id: str
    error: str
    def __init__(self, job_id: _Optional[str] = ..., document_id: _Optional[str] = ..., error: _Optional[str] = ...) -> None: ...
