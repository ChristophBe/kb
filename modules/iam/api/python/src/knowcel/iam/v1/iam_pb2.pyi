from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class TeamRole(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    TEAM_ROLE_UNSPECIFIED: _ClassVar[TeamRole]
    TEAM_ROLE_ADMIN: _ClassVar[TeamRole]
    TEAM_ROLE_MEMBER: _ClassVar[TeamRole]
TEAM_ROLE_UNSPECIFIED: TeamRole
TEAM_ROLE_ADMIN: TeamRole
TEAM_ROLE_MEMBER: TeamRole

class User(_message.Message):
    __slots__ = ("id", "email", "display_name", "platform_admin")
    ID_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    PLATFORM_ADMIN_FIELD_NUMBER: _ClassVar[int]
    id: str
    email: str
    display_name: str
    platform_admin: bool
    def __init__(self, id: _Optional[str] = ..., email: _Optional[str] = ..., display_name: _Optional[str] = ..., platform_admin: _Optional[bool] = ...) -> None: ...

class GetCurrentUserRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class GetCurrentUserResponse(_message.Message):
    __slots__ = ("user",)
    USER_FIELD_NUMBER: _ClassVar[int]
    user: User
    def __init__(self, user: _Optional[_Union[User, _Mapping]] = ...) -> None: ...

class Team(_message.Message):
    __slots__ = ("id", "name", "my_role", "members")
    ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    MY_ROLE_FIELD_NUMBER: _ClassVar[int]
    MEMBERS_FIELD_NUMBER: _ClassVar[int]
    id: str
    name: str
    my_role: TeamRole
    members: _containers.RepeatedCompositeFieldContainer[TeamMember]
    def __init__(self, id: _Optional[str] = ..., name: _Optional[str] = ..., my_role: _Optional[_Union[TeamRole, str]] = ..., members: _Optional[_Iterable[_Union[TeamMember, _Mapping]]] = ...) -> None: ...

class TeamMember(_message.Message):
    __slots__ = ("user_id", "email", "display_name", "role")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    email: str
    display_name: str
    role: TeamRole
    def __init__(self, user_id: _Optional[str] = ..., email: _Optional[str] = ..., display_name: _Optional[str] = ..., role: _Optional[_Union[TeamRole, str]] = ...) -> None: ...

class CreateTeamRequest(_message.Message):
    __slots__ = ("name",)
    NAME_FIELD_NUMBER: _ClassVar[int]
    name: str
    def __init__(self, name: _Optional[str] = ...) -> None: ...

class CreateTeamResponse(_message.Message):
    __slots__ = ("team",)
    TEAM_FIELD_NUMBER: _ClassVar[int]
    team: Team
    def __init__(self, team: _Optional[_Union[Team, _Mapping]] = ...) -> None: ...

class GetTeamRequest(_message.Message):
    __slots__ = ("id",)
    ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    def __init__(self, id: _Optional[str] = ...) -> None: ...

class GetTeamResponse(_message.Message):
    __slots__ = ("team",)
    TEAM_FIELD_NUMBER: _ClassVar[int]
    team: Team
    def __init__(self, team: _Optional[_Union[Team, _Mapping]] = ...) -> None: ...

class ListMyTeamsRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class ListMyTeamsResponse(_message.Message):
    __slots__ = ("teams",)
    TEAMS_FIELD_NUMBER: _ClassVar[int]
    teams: _containers.RepeatedCompositeFieldContainer[Team]
    def __init__(self, teams: _Optional[_Iterable[_Union[Team, _Mapping]]] = ...) -> None: ...

class UpdateTeamRequest(_message.Message):
    __slots__ = ("id", "name")
    ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    id: str
    name: str
    def __init__(self, id: _Optional[str] = ..., name: _Optional[str] = ...) -> None: ...

class UpdateTeamResponse(_message.Message):
    __slots__ = ("team",)
    TEAM_FIELD_NUMBER: _ClassVar[int]
    team: Team
    def __init__(self, team: _Optional[_Union[Team, _Mapping]] = ...) -> None: ...

class DeleteTeamRequest(_message.Message):
    __slots__ = ("id",)
    ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    def __init__(self, id: _Optional[str] = ...) -> None: ...

class DeleteTeamResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class AddMemberRequest(_message.Message):
    __slots__ = ("team_id", "email", "role")
    TEAM_ID_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    team_id: str
    email: str
    role: TeamRole
    def __init__(self, team_id: _Optional[str] = ..., email: _Optional[str] = ..., role: _Optional[_Union[TeamRole, str]] = ...) -> None: ...

class AddMemberResponse(_message.Message):
    __slots__ = ("member",)
    MEMBER_FIELD_NUMBER: _ClassVar[int]
    member: TeamMember
    def __init__(self, member: _Optional[_Union[TeamMember, _Mapping]] = ...) -> None: ...

class RemoveMemberRequest(_message.Message):
    __slots__ = ("team_id", "user_id")
    TEAM_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    team_id: str
    user_id: str
    def __init__(self, team_id: _Optional[str] = ..., user_id: _Optional[str] = ...) -> None: ...

class RemoveMemberResponse(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class SetMemberRoleRequest(_message.Message):
    __slots__ = ("team_id", "user_id", "role")
    TEAM_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    team_id: str
    user_id: str
    role: TeamRole
    def __init__(self, team_id: _Optional[str] = ..., user_id: _Optional[str] = ..., role: _Optional[_Union[TeamRole, str]] = ...) -> None: ...

class SetMemberRoleResponse(_message.Message):
    __slots__ = ("member",)
    MEMBER_FIELD_NUMBER: _ClassVar[int]
    member: TeamMember
    def __init__(self, member: _Optional[_Union[TeamMember, _Mapping]] = ...) -> None: ...

class ResolveCallerRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class ResolveCallerResponse(_message.Message):
    __slots__ = ("user_id", "platform_admin", "teams")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    PLATFORM_ADMIN_FIELD_NUMBER: _ClassVar[int]
    TEAMS_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    platform_admin: bool
    teams: _containers.RepeatedCompositeFieldContainer[CallerTeam]
    def __init__(self, user_id: _Optional[str] = ..., platform_admin: _Optional[bool] = ..., teams: _Optional[_Iterable[_Union[CallerTeam, _Mapping]]] = ...) -> None: ...

class CallerTeam(_message.Message):
    __slots__ = ("team_id", "role")
    TEAM_ID_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    team_id: str
    role: TeamRole
    def __init__(self, team_id: _Optional[str] = ..., role: _Optional[_Union[TeamRole, str]] = ...) -> None: ...
