from kb.ingestion.v1 import ingestion_pb2 as _ingestion_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class DocumentUploaded(_message.Message):
    __slots__ = ("job_id", "document_id", "filename", "content_type", "run")
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    RUN_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    document_id: str
    filename: str
    content_type: str
    run: int
    def __init__(self, job_id: _Optional[str] = ..., document_id: _Optional[str] = ..., filename: _Optional[str] = ..., content_type: _Optional[str] = ..., run: _Optional[int] = ...) -> None: ...

class ProcessingStarted(_message.Message):
    __slots__ = ("job_id", "document_id", "run")
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    RUN_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    document_id: str
    run: int
    def __init__(self, job_id: _Optional[str] = ..., document_id: _Optional[str] = ..., run: _Optional[int] = ...) -> None: ...

class ProcessingProgress(_message.Message):
    __slots__ = ("job_id", "document_id", "run", "stage", "progress")
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    RUN_FIELD_NUMBER: _ClassVar[int]
    STAGE_FIELD_NUMBER: _ClassVar[int]
    PROGRESS_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    document_id: str
    run: int
    stage: _ingestion_pb2.JobStage
    progress: int
    def __init__(self, job_id: _Optional[str] = ..., document_id: _Optional[str] = ..., run: _Optional[int] = ..., stage: _Optional[_Union[_ingestion_pb2.JobStage, str]] = ..., progress: _Optional[int] = ...) -> None: ...

class DocumentProcessed(_message.Message):
    __slots__ = ("job_id", "document_id", "chunk_count", "run")
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    CHUNK_COUNT_FIELD_NUMBER: _ClassVar[int]
    RUN_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    document_id: str
    chunk_count: int
    run: int
    def __init__(self, job_id: _Optional[str] = ..., document_id: _Optional[str] = ..., chunk_count: _Optional[int] = ..., run: _Optional[int] = ...) -> None: ...

class ProcessingFailed(_message.Message):
    __slots__ = ("job_id", "document_id", "error", "run")
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    RUN_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    document_id: str
    error: str
    run: int
    def __init__(self, job_id: _Optional[str] = ..., document_id: _Optional[str] = ..., error: _Optional[str] = ..., run: _Optional[int] = ...) -> None: ...
