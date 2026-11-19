import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from knowcel.common.v1 import common_pb2 as _common_pb2
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

class ProgressStage(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    PROGRESS_STAGE_UNSPECIFIED: _ClassVar[ProgressStage]
    PROGRESS_STAGE_SEARCHING: _ClassVar[ProgressStage]
    PROGRESS_STAGE_RATING: _ClassVar[ProgressStage]
    PROGRESS_STAGE_WRITING: _ClassVar[ProgressStage]
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
PROGRESS_STAGE_UNSPECIFIED: ProgressStage
PROGRESS_STAGE_SEARCHING: ProgressStage
PROGRESS_STAGE_RATING: ProgressStage
PROGRESS_STAGE_WRITING: ProgressStage

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
    __slots__ = ("id", "title", "create_time", "update_time", "document_ids", "last_message_time", "last_message_preview", "owner_id", "team_ids", "generating", "completed_unseen", "system_prompt")
    ID_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    CREATE_TIME_FIELD_NUMBER: _ClassVar[int]
    UPDATE_TIME_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_IDS_FIELD_NUMBER: _ClassVar[int]
    LAST_MESSAGE_TIME_FIELD_NUMBER: _ClassVar[int]
    LAST_MESSAGE_PREVIEW_FIELD_NUMBER: _ClassVar[int]
    OWNER_ID_FIELD_NUMBER: _ClassVar[int]
    TEAM_IDS_FIELD_NUMBER: _ClassVar[int]
    GENERATING_FIELD_NUMBER: _ClassVar[int]
    COMPLETED_UNSEEN_FIELD_NUMBER: _ClassVar[int]
    SYSTEM_PROMPT_FIELD_NUMBER: _ClassVar[int]
    id: str
    title: str
    create_time: _timestamp_pb2.Timestamp
    update_time: _timestamp_pb2.Timestamp
    document_ids: _containers.RepeatedScalarFieldContainer[str]
    last_message_time: _timestamp_pb2.Timestamp
    last_message_preview: str
    owner_id: str
    team_ids: _containers.RepeatedScalarFieldContainer[str]
    generating: bool
    completed_unseen: bool
    system_prompt: str
    def __init__(self, id: _Optional[str] = ..., title: _Optional[str] = ..., create_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., update_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., document_ids: _Optional[_Iterable[str]] = ..., last_message_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., last_message_preview: _Optional[str] = ..., owner_id: _Optional[str] = ..., team_ids: _Optional[_Iterable[str]] = ..., generating: _Optional[bool] = ..., completed_unseen: _Optional[bool] = ..., system_prompt: _Optional[str] = ...) -> None: ...

class TeamIds(_message.Message):
    __slots__ = ("ids",)
    IDS_FIELD_NUMBER: _ClassVar[int]
    ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, ids: _Optional[_Iterable[str]] = ...) -> None: ...

class DocumentIds(_message.Message):
    __slots__ = ("ids",)
    IDS_FIELD_NUMBER: _ClassVar[int]
    ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, ids: _Optional[_Iterable[str]] = ...) -> None: ...

class CreateConversationRequest(_message.Message):
    __slots__ = ("title", "document_ids", "team_ids")
    TITLE_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_IDS_FIELD_NUMBER: _ClassVar[int]
    TEAM_IDS_FIELD_NUMBER: _ClassVar[int]
    title: str
    document_ids: _containers.RepeatedScalarFieldContainer[str]
    team_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, title: _Optional[str] = ..., document_ids: _Optional[_Iterable[str]] = ..., team_ids: _Optional[_Iterable[str]] = ...) -> None: ...

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
    __slots__ = ("id", "title", "document_ids", "team_ids", "system_prompt")
    ID_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    DOCUMENT_IDS_FIELD_NUMBER: _ClassVar[int]
    TEAM_IDS_FIELD_NUMBER: _ClassVar[int]
    SYSTEM_PROMPT_FIELD_NUMBER: _ClassVar[int]
    id: str
    title: str
    document_ids: DocumentIds
    team_ids: TeamIds
    system_prompt: str
    def __init__(self, id: _Optional[str] = ..., title: _Optional[str] = ..., document_ids: _Optional[_Union[DocumentIds, _Mapping]] = ..., team_ids: _Optional[_Union[TeamIds, _Mapping]] = ..., system_prompt: _Optional[str] = ...) -> None: ...

class UpdateConversationResponse(_message.Message):
    __slots__ = ("conversation",)
    CONVERSATION_FIELD_NUMBER: _ClassVar[int]
    conversation: Conversation
    def __init__(self, conversation: _Optional[_Union[Conversation, _Mapping]] = ...) -> None: ...

class SearchConversationsRequest(_message.Message):
    __slots__ = ("query", "limit")
    QUERY_FIELD_NUMBER: _ClassVar[int]
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    query: str
    limit: int
    def __init__(self, query: _Optional[str] = ..., limit: _Optional[int] = ...) -> None: ...

class SearchConversationsResponse(_message.Message):
    __slots__ = ("results",)
    RESULTS_FIELD_NUMBER: _ClassVar[int]
    results: _containers.RepeatedCompositeFieldContainer[ConversationMatch]
    def __init__(self, results: _Optional[_Iterable[_Union[ConversationMatch, _Mapping]]] = ...) -> None: ...

class ConversationMatch(_message.Message):
    __slots__ = ("conversation", "snippet")
    CONVERSATION_FIELD_NUMBER: _ClassVar[int]
    SNIPPET_FIELD_NUMBER: _ClassVar[int]
    conversation: Conversation
    snippet: str
    def __init__(self, conversation: _Optional[_Union[Conversation, _Mapping]] = ..., snippet: _Optional[str] = ...) -> None: ...

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

class StopChatRequest(_message.Message):
    __slots__ = ("conversation_id",)
    CONVERSATION_ID_FIELD_NUMBER: _ClassVar[int]
    conversation_id: str
    def __init__(self, conversation_id: _Optional[str] = ...) -> None: ...

class StopChatResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class StreamChatResponse(_message.Message):
    __slots__ = ("citations", "delta", "message", "error", "progress")
    CITATIONS_FIELD_NUMBER: _ClassVar[int]
    DELTA_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    PROGRESS_FIELD_NUMBER: _ClassVar[int]
    citations: Citations
    delta: str
    message: ChatMessage
    error: ChatError
    progress: ProgressStage
    def __init__(self, citations: _Optional[_Union[Citations, _Mapping]] = ..., delta: _Optional[str] = ..., message: _Optional[_Union[ChatMessage, _Mapping]] = ..., error: _Optional[_Union[ChatError, _Mapping]] = ..., progress: _Optional[_Union[ProgressStage, str]] = ...) -> None: ...

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

class PromptTemplates(_message.Message):
    __slots__ = ("system_prompt", "sources_template", "no_sources_template", "variables")
    SYSTEM_PROMPT_FIELD_NUMBER: _ClassVar[int]
    SOURCES_TEMPLATE_FIELD_NUMBER: _ClassVar[int]
    NO_SOURCES_TEMPLATE_FIELD_NUMBER: _ClassVar[int]
    VARIABLES_FIELD_NUMBER: _ClassVar[int]
    system_prompt: PromptTemplate
    sources_template: PromptTemplate
    no_sources_template: PromptTemplate
    variables: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, system_prompt: _Optional[_Union[PromptTemplate, _Mapping]] = ..., sources_template: _Optional[_Union[PromptTemplate, _Mapping]] = ..., no_sources_template: _Optional[_Union[PromptTemplate, _Mapping]] = ..., variables: _Optional[_Iterable[str]] = ...) -> None: ...

class PromptTemplate(_message.Message):
    __slots__ = ("content", "default_content", "is_default")
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_CONTENT_FIELD_NUMBER: _ClassVar[int]
    IS_DEFAULT_FIELD_NUMBER: _ClassVar[int]
    content: str
    default_content: str
    is_default: bool
    def __init__(self, content: _Optional[str] = ..., default_content: _Optional[str] = ..., is_default: _Optional[bool] = ...) -> None: ...

class GetPromptTemplatesRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class GetPromptTemplatesResponse(_message.Message):
    __slots__ = ("templates",)
    TEMPLATES_FIELD_NUMBER: _ClassVar[int]
    templates: PromptTemplates
    def __init__(self, templates: _Optional[_Union[PromptTemplates, _Mapping]] = ...) -> None: ...

class UpdatePromptTemplatesRequest(_message.Message):
    __slots__ = ("system_prompt", "sources_template", "no_sources_template")
    SYSTEM_PROMPT_FIELD_NUMBER: _ClassVar[int]
    SOURCES_TEMPLATE_FIELD_NUMBER: _ClassVar[int]
    NO_SOURCES_TEMPLATE_FIELD_NUMBER: _ClassVar[int]
    system_prompt: str
    sources_template: str
    no_sources_template: str
    def __init__(self, system_prompt: _Optional[str] = ..., sources_template: _Optional[str] = ..., no_sources_template: _Optional[str] = ...) -> None: ...

class UpdatePromptTemplatesResponse(_message.Message):
    __slots__ = ("templates",)
    TEMPLATES_FIELD_NUMBER: _ClassVar[int]
    templates: PromptTemplates
    def __init__(self, templates: _Optional[_Union[PromptTemplates, _Mapping]] = ...) -> None: ...
