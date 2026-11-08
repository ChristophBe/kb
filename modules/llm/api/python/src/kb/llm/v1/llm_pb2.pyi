from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class Role(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    ROLE_UNSPECIFIED: _ClassVar[Role]
    ROLE_SYSTEM: _ClassVar[Role]
    ROLE_USER: _ClassVar[Role]
    ROLE_ASSISTANT: _ClassVar[Role]

class ModelKind(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    MODEL_KIND_UNSPECIFIED: _ClassVar[ModelKind]
    MODEL_KIND_CHAT: _ClassVar[ModelKind]
    MODEL_KIND_EMBEDDING: _ClassVar[ModelKind]
ROLE_UNSPECIFIED: Role
ROLE_SYSTEM: Role
ROLE_USER: Role
ROLE_ASSISTANT: Role
MODEL_KIND_UNSPECIFIED: ModelKind
MODEL_KIND_CHAT: ModelKind
MODEL_KIND_EMBEDDING: ModelKind

class Model(_message.Message):
    __slots__ = ("id", "provider", "kind")
    ID_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    id: str
    provider: str
    kind: ModelKind
    def __init__(self, id: _Optional[str] = ..., provider: _Optional[str] = ..., kind: _Optional[_Union[ModelKind, str]] = ...) -> None: ...

class Message(_message.Message):
    __slots__ = ("role", "content")
    ROLE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    role: Role
    content: str
    def __init__(self, role: _Optional[_Union[Role, str]] = ..., content: _Optional[str] = ...) -> None: ...

class GenerationOptions(_message.Message):
    __slots__ = ("temperature", "max_tokens")
    TEMPERATURE_FIELD_NUMBER: _ClassVar[int]
    MAX_TOKENS_FIELD_NUMBER: _ClassVar[int]
    temperature: float
    max_tokens: int
    def __init__(self, temperature: _Optional[float] = ..., max_tokens: _Optional[int] = ...) -> None: ...

class Usage(_message.Message):
    __slots__ = ("input_tokens", "output_tokens")
    INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    input_tokens: int
    output_tokens: int
    def __init__(self, input_tokens: _Optional[int] = ..., output_tokens: _Optional[int] = ...) -> None: ...

class ListModelsRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class ListModelsResponse(_message.Message):
    __slots__ = ("models",)
    MODELS_FIELD_NUMBER: _ClassVar[int]
    models: _containers.RepeatedCompositeFieldContainer[Model]
    def __init__(self, models: _Optional[_Iterable[_Union[Model, _Mapping]]] = ...) -> None: ...

class GetProviderStatusRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class ProviderHealth(_message.Message):
    __slots__ = ("provider", "healthy", "detail")
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    HEALTHY_FIELD_NUMBER: _ClassVar[int]
    DETAIL_FIELD_NUMBER: _ClassVar[int]
    provider: str
    healthy: bool
    detail: str
    def __init__(self, provider: _Optional[str] = ..., healthy: _Optional[bool] = ..., detail: _Optional[str] = ...) -> None: ...

class GetProviderStatusResponse(_message.Message):
    __slots__ = ("provider", "healthy", "detail", "default_chat_model", "default_embedding_model", "embedding_dimensions", "chat", "embedding")
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    HEALTHY_FIELD_NUMBER: _ClassVar[int]
    DETAIL_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_CHAT_MODEL_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_EMBEDDING_MODEL_FIELD_NUMBER: _ClassVar[int]
    EMBEDDING_DIMENSIONS_FIELD_NUMBER: _ClassVar[int]
    CHAT_FIELD_NUMBER: _ClassVar[int]
    EMBEDDING_FIELD_NUMBER: _ClassVar[int]
    provider: str
    healthy: bool
    detail: str
    default_chat_model: str
    default_embedding_model: str
    embedding_dimensions: int
    chat: ProviderHealth
    embedding: ProviderHealth
    def __init__(self, provider: _Optional[str] = ..., healthy: _Optional[bool] = ..., detail: _Optional[str] = ..., default_chat_model: _Optional[str] = ..., default_embedding_model: _Optional[str] = ..., embedding_dimensions: _Optional[int] = ..., chat: _Optional[_Union[ProviderHealth, _Mapping]] = ..., embedding: _Optional[_Union[ProviderHealth, _Mapping]] = ...) -> None: ...

class GenerateRequest(_message.Message):
    __slots__ = ("model", "messages", "options")
    MODEL_FIELD_NUMBER: _ClassVar[int]
    MESSAGES_FIELD_NUMBER: _ClassVar[int]
    OPTIONS_FIELD_NUMBER: _ClassVar[int]
    model: str
    messages: _containers.RepeatedCompositeFieldContainer[Message]
    options: GenerationOptions
    def __init__(self, model: _Optional[str] = ..., messages: _Optional[_Iterable[_Union[Message, _Mapping]]] = ..., options: _Optional[_Union[GenerationOptions, _Mapping]] = ...) -> None: ...

class GenerateResponse(_message.Message):
    __slots__ = ("delta", "done", "usage", "model")
    DELTA_FIELD_NUMBER: _ClassVar[int]
    DONE_FIELD_NUMBER: _ClassVar[int]
    USAGE_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    delta: str
    done: bool
    usage: Usage
    model: str
    def __init__(self, delta: _Optional[str] = ..., done: _Optional[bool] = ..., usage: _Optional[_Union[Usage, _Mapping]] = ..., model: _Optional[str] = ...) -> None: ...

class EmbedRequest(_message.Message):
    __slots__ = ("model", "inputs")
    MODEL_FIELD_NUMBER: _ClassVar[int]
    INPUTS_FIELD_NUMBER: _ClassVar[int]
    model: str
    inputs: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, model: _Optional[str] = ..., inputs: _Optional[_Iterable[str]] = ...) -> None: ...

class Embedding(_message.Message):
    __slots__ = ("values",)
    VALUES_FIELD_NUMBER: _ClassVar[int]
    values: _containers.RepeatedScalarFieldContainer[float]
    def __init__(self, values: _Optional[_Iterable[float]] = ...) -> None: ...

class EmbedResponse(_message.Message):
    __slots__ = ("embeddings", "model", "dimensions")
    EMBEDDINGS_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    DIMENSIONS_FIELD_NUMBER: _ClassVar[int]
    embeddings: _containers.RepeatedCompositeFieldContainer[Embedding]
    model: str
    dimensions: int
    def __init__(self, embeddings: _Optional[_Iterable[_Union[Embedding, _Mapping]]] = ..., model: _Optional[str] = ..., dimensions: _Optional[int] = ...) -> None: ...
