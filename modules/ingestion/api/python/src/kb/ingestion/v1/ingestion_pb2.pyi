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

class JobStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    JOB_STATUS_UNSPECIFIED: _ClassVar[JobStatus]
    JOB_STATUS_PENDING_UPLOAD: _ClassVar[JobStatus]
    JOB_STATUS_QUEUED: _ClassVar[JobStatus]
    JOB_STATUS_PROCESSING: _ClassVar[JobStatus]
    JOB_STATUS_DONE: _ClassVar[JobStatus]
    JOB_STATUS_FAILED: _ClassVar[JobStatus]

class JobStage(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    JOB_STAGE_UNSPECIFIED: _ClassVar[JobStage]
    JOB_STAGE_EXTRACTING: _ClassVar[JobStage]
    JOB_STAGE_CHUNKING: _ClassVar[JobStage]
    JOB_STAGE_EMBEDDING: _ClassVar[JobStage]
    JOB_STAGE_STORING: _ClassVar[JobStage]
JOB_STATUS_UNSPECIFIED: JobStatus
JOB_STATUS_PENDING_UPLOAD: JobStatus
JOB_STATUS_QUEUED: JobStatus
JOB_STATUS_PROCESSING: JobStatus
JOB_STATUS_DONE: JobStatus
JOB_STATUS_FAILED: JobStatus
JOB_STAGE_UNSPECIFIED: JobStage
JOB_STAGE_EXTRACTING: JobStage
JOB_STAGE_CHUNKING: JobStage
JOB_STAGE_EMBEDDING: JobStage
JOB_STAGE_STORING: JobStage

class Job(_message.Message):
    __slots__ = ("id", "document_id", "filename", "content_type", "status", "error", "chunk_count", "create_time", "update_time", "progress", "stage", "owner_id")
    ID_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    CHUNK_COUNT_FIELD_NUMBER: _ClassVar[int]
    CREATE_TIME_FIELD_NUMBER: _ClassVar[int]
    UPDATE_TIME_FIELD_NUMBER: _ClassVar[int]
    PROGRESS_FIELD_NUMBER: _ClassVar[int]
    STAGE_FIELD_NUMBER: _ClassVar[int]
    OWNER_ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    document_id: str
    filename: str
    content_type: str
    status: JobStatus
    error: str
    chunk_count: int
    create_time: _timestamp_pb2.Timestamp
    update_time: _timestamp_pb2.Timestamp
    progress: int
    stage: JobStage
    owner_id: str
    def __init__(self, id: _Optional[str] = ..., document_id: _Optional[str] = ..., filename: _Optional[str] = ..., content_type: _Optional[str] = ..., status: _Optional[_Union[JobStatus, str]] = ..., error: _Optional[str] = ..., chunk_count: _Optional[int] = ..., create_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., update_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., progress: _Optional[int] = ..., stage: _Optional[_Union[JobStage, str]] = ..., owner_id: _Optional[str] = ...) -> None: ...

class CreateUploadRequest(_message.Message):
    __slots__ = ("filename", "content_type", "size_bytes", "title")
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    filename: str
    content_type: str
    size_bytes: int
    title: str
    def __init__(self, filename: _Optional[str] = ..., content_type: _Optional[str] = ..., size_bytes: _Optional[int] = ..., title: _Optional[str] = ...) -> None: ...

class CreateUploadResponse(_message.Message):
    __slots__ = ("job", "upload_url")
    JOB_FIELD_NUMBER: _ClassVar[int]
    UPLOAD_URL_FIELD_NUMBER: _ClassVar[int]
    job: Job
    upload_url: str
    def __init__(self, job: _Optional[_Union[Job, _Mapping]] = ..., upload_url: _Optional[str] = ...) -> None: ...

class CompleteUploadRequest(_message.Message):
    __slots__ = ("job_id",)
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    def __init__(self, job_id: _Optional[str] = ...) -> None: ...

class CompleteUploadResponse(_message.Message):
    __slots__ = ("job",)
    JOB_FIELD_NUMBER: _ClassVar[int]
    job: Job
    def __init__(self, job: _Optional[_Union[Job, _Mapping]] = ...) -> None: ...

class GetJobRequest(_message.Message):
    __slots__ = ("id",)
    ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    def __init__(self, id: _Optional[str] = ...) -> None: ...

class GetJobResponse(_message.Message):
    __slots__ = ("job",)
    JOB_FIELD_NUMBER: _ClassVar[int]
    job: Job
    def __init__(self, job: _Optional[_Union[Job, _Mapping]] = ...) -> None: ...

class ListJobsRequest(_message.Message):
    __slots__ = ("page",)
    PAGE_FIELD_NUMBER: _ClassVar[int]
    page: _common_pb2.PageRequest
    def __init__(self, page: _Optional[_Union[_common_pb2.PageRequest, _Mapping]] = ...) -> None: ...

class ListJobsResponse(_message.Message):
    __slots__ = ("jobs", "page")
    JOBS_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    jobs: _containers.RepeatedCompositeFieldContainer[Job]
    page: _common_pb2.PageResponse
    def __init__(self, jobs: _Optional[_Iterable[_Union[Job, _Mapping]]] = ..., page: _Optional[_Union[_common_pb2.PageResponse, _Mapping]] = ...) -> None: ...

class WatchJobRequest(_message.Message):
    __slots__ = ("id",)
    ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    def __init__(self, id: _Optional[str] = ...) -> None: ...

class WatchJobResponse(_message.Message):
    __slots__ = ("job",)
    JOB_FIELD_NUMBER: _ClassVar[int]
    job: Job
    def __init__(self, job: _Optional[_Union[Job, _Mapping]] = ...) -> None: ...

class ReprocessJobRequest(_message.Message):
    __slots__ = ("id",)
    ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    def __init__(self, id: _Optional[str] = ...) -> None: ...

class ReprocessJobResponse(_message.Message):
    __slots__ = ("job",)
    JOB_FIELD_NUMBER: _ClassVar[int]
    job: Job
    def __init__(self, job: _Optional[_Union[Job, _Mapping]] = ...) -> None: ...
