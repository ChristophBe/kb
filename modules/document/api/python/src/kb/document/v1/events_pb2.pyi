from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class DocumentReindexRequested(_message.Message):
    __slots__ = ("document_id", "owner_id", "embedding_model")
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    OWNER_ID_FIELD_NUMBER: _ClassVar[int]
    EMBEDDING_MODEL_FIELD_NUMBER: _ClassVar[int]
    document_id: str
    owner_id: str
    embedding_model: str
    def __init__(self, document_id: _Optional[str] = ..., owner_id: _Optional[str] = ..., embedding_model: _Optional[str] = ...) -> None: ...
