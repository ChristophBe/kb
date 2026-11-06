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

class MessageRole(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    MESSAGE_ROLE_UNSPECIFIED: _ClassVar[MessageRole]
    MESSAGE_ROLE_USER: _ClassVar[MessageRole]
    MESSAGE_ROLE_ASSISTANT: _ClassVar[MessageRole]

class MessageStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    MESSAGE_STATUS_UNSPECIFIED: _ClassVar[MessageStatus]
    MESSAGE_STATUS_COMPLETE: _ClassVar[MessageStatus]
    MESSAGE_STATUS_STOPPED: _ClassVar[MessageStatus]
    MESSAGE_STATUS_FAILED: _ClassVar[MessageStatus]

class ChatErrorCode(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    CHAT_ERROR_CODE_UNSPECIFIED: _ClassVar[ChatErrorCode]
    CHAT_ERROR_CODE_UNAVAILABLE: _ClassVar[ChatErrorCode]
    CHAT_ERROR_CODE_INTERNAL: _ClassVar[ChatErrorCode]
MESSAGE_ROLE_UNSPECIFIED: MessageRole
MESSAGE_ROLE_USER: MessageRole
MESSAGE_ROLE_ASSISTANT: MessageRole
MESSAGE_STATUS_UNSPECIFIED: MessageStatus
MESSAGE_STATUS_COMPLETE: MessageStatus
MESSAGE_STATUS_STOPPED: MessageStatus
MESSAGE_STATUS_FAILED: MessageStatus
CHAT_ERROR_CODE_UNSPECIFIED: ChatErrorCode
CHAT_ERROR_CODE_UNAVAILABLE: ChatErrorCode
CHAT_ERROR_CODE_INTERNAL: ChatErrorCode

class Citation(_message.Message):
    __slots__ = ("document_id", "document_title", "chunk_index", "snippet", "score", "manual_page", "manual_section")
    DOCUMENT_ID_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_TITLE_FIELD_NUMBER: _ClassVar[int]
    CHUNK_INDEX_FIELD_NUMBER: _ClassVar[int]
    SNIPPET_FIELD_NUMBER: _ClassVar[int]
    SCORE_FIELD_NUMBER: _ClassVar[int]
    MANUAL_PAGE_FIELD_NUMBER: _ClassVar[int]
    MANUAL_SECTION_FIELD_NUMBER: _ClassVar[int]
    document_id: str
    document_title: str
    chunk_index: int
    snippet: str
    score: float
    manual_page: str
    manual_section: str
    def __init__(self, document_id: _Optional[str] = ..., document_title: _Optional[str] = ..., chunk_index: _Optional[int] = ..., snippet: _Optional[str] = ..., score: _Optional[float] = ..., manual_page: _Optional[str] = ..., manual_section: _Optional[str] = ...) -> None: ...

class ChatMessage(_message.Message):
    __slots__ = ("id", "role", "content", "citations", "create_time", "status")
    ID_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    CITATIONS_FIELD_NUMBER: _ClassVar[int]
    CREATE_TIME_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    id: str
    role: MessageRole
    content: str
    citations: _containers.RepeatedCompositeFieldContainer[Citation]
    create_time: _timestamp_pb2.Timestamp
    status: MessageStatus
    def __init__(self, id: _Optional[str] = ..., role: _Optional[_Union[MessageRole, str]] = ..., content: _Optional[str] = ..., citations: _Optional[_Iterable[_Union[Citation, _Mapping]]] = ..., create_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., status: _Optional[_Union[MessageStatus, str]] = ...) -> None: ...

class Conversation(_message.Message):
    __slots__ = ("id", "title", "create_time", "update_time", "document_ids", "last_message_time", "last_message_preview")
    ID_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    CREATE_TIME_FIELD_NUMBER: _ClassVar[int]
    UPDATE_TIME_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_IDS_FIELD_NUMBER: _ClassVar[int]
    LAST_MESSAGE_TIME_FIELD_NUMBER: _ClassVar[int]
    LAST_MESSAGE_PREVIEW_FIELD_NUMBER: _ClassVar[int]
    id: str
    title: str
    create_time: _timestamp_pb2.Timestamp
    update_time: _timestamp_pb2.Timestamp
    document_ids: _containers.RepeatedScalarFieldContainer[str]
    last_message_time: _timestamp_pb2.Timestamp
    last_message_preview: str
    def __init__(self, id: _Optional[str] = ..., title: _Optional[str] = ..., create_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., update_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., document_ids: _Optional[_Iterable[str]] = ..., last_message_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., last_message_preview: _Optional[str] = ...) -> None: ...

class DocumentIds(_message.Message):
    __slots__ = ("ids",)
    IDS_FIELD_NUMBER: _ClassVar[int]
    ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, ids: _Optional[_Iterable[str]] = ...) -> None: ...

class CreateConversationRequest(_message.Message):
    __slots__ = ("title", "document_ids")
    TITLE_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_IDS_FIELD_NUMBER: _ClassVar[int]
    title: str
    document_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, title: _Optional[str] = ..., document_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class CreateConversationResponse(_message.Message):
    __slots__ = ("conversation",)
    CONVERSATION_FIELD_NUMBER: _ClassVar[int]
    conversation: Conversation
    def __init__(self, conversation: _Optional[_Union[Conversation, _Mapping]] = ...) -> None: ...

class GetConversationRequest(_message.Message):
    __slots__ = ("id",)
    ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    def __init__(self, id: _Optional[str] = ...) -> None: ...

class GetConversationResponse(_message.Message):
    __slots__ = ("conversation", "messages")
    CONVERSATION_FIELD_NUMBER: _ClassVar[int]
    MESSAGES_FIELD_NUMBER: _ClassVar[int]
    conversation: Conversation
    messages: _containers.RepeatedCompositeFieldContainer[ChatMessage]
    def __init__(self, conversation: _Optional[_Union[Conversation, _Mapping]] = ..., messages: _Optional[_Iterable[_Union[ChatMessage, _Mapping]]] = ...) -> None: ...

class ListConversationsRequest(_message.Message):
    __slots__ = ("page",)
    PAGE_FIELD_NUMBER: _ClassVar[int]
    page: _common_pb2.PageRequest
    def __init__(self, page: _Optional[_Union[_common_pb2.PageRequest, _Mapping]] = ...) -> None: ...

class ListConversationsResponse(_message.Message):
    __slots__ = ("conversations", "page")
    CONVERSATIONS_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    conversations: _containers.RepeatedCompositeFieldContainer[Conversation]
    page: _common_pb2.PageResponse
    def __init__(self, conversations: _Optional[_Iterable[_Union[Conversation, _Mapping]]] = ..., page: _Optional[_Union[_common_pb2.PageResponse, _Mapping]] = ...) -> None: ...

class DeleteConversationRequest(_message.Message):
    __slots__ = ("id",)
    ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    def __init__(self, id: _Optional[str] = ...) -> None: ...

class DeleteConversationResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class UpdateConversationRequest(_message.Message):
    __slots__ = ("id", "title", "document_ids")
    ID_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_IDS_FIELD_NUMBER: _ClassVar[int]
    id: str
    title: str
    document_ids: DocumentIds
    def __init__(self, id: _Optional[str] = ..., title: _Optional[str] = ..., document_ids: _Optional[_Union[DocumentIds, _Mapping]] = ...) -> None: ...

class UpdateConversationResponse(_message.Message):
    __slots__ = ("conversation",)
    CONVERSATION_FIELD_NUMBER: _ClassVar[int]
    conversation: Conversation
    def __init__(self, conversation: _Optional[_Union[Conversation, _Mapping]] = ...) -> None: ...

class StreamChatRequest(_message.Message):
    __slots__ = ("conversation_id", "content", "use_knowledge_base", "model")
    CONVERSATION_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    USE_KNOWLEDGE_BASE_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    conversation_id: str
    content: str
    use_knowledge_base: bool
    model: str
    def __init__(self, conversation_id: _Optional[str] = ..., content: _Optional[str] = ..., use_knowledge_base: _Optional[bool] = ..., model: _Optional[str] = ...) -> None: ...

class StreamChatResponse(_message.Message):
    __slots__ = ("citations", "delta", "message", "error")
    CITATIONS_FIELD_NUMBER: _ClassVar[int]
    DELTA_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    citations: Citations
    delta: str
    message: ChatMessage
    error: ChatError
    def __init__(self, citations: _Optional[_Union[Citations, _Mapping]] = ..., delta: _Optional[str] = ..., message: _Optional[_Union[ChatMessage, _Mapping]] = ..., error: _Optional[_Union[ChatError, _Mapping]] = ...) -> None: ...

class ChatError(_message.Message):
    __slots__ = ("code", "message")
    CODE_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    code: ChatErrorCode
    message: str
    def __init__(self, code: _Optional[_Union[ChatErrorCode, str]] = ..., message: _Optional[str] = ...) -> None: ...

class Citations(_message.Message):
    __slots__ = ("items",)
    ITEMS_FIELD_NUMBER: _ClassVar[int]
    items: _containers.RepeatedCompositeFieldContainer[Citation]
    def __init__(self, items: _Optional[_Iterable[_Union[Citation, _Mapping]]] = ...) -> None: ...
