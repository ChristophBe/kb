from knowcel.iam.v1 import iam_pb2, iam_pb2_grpc
from knowcel_platform.grpc import Principal, ResolveFunc, Team


def resolver(iam: iam_pb2_grpc.IamServiceStub) -> ResolveFunc:
    """Resolves callers through the iam module, which the platform's
    `PrincipalResolver` caches. Only the caller's teams matter here."""

    async def resolve(user: str) -> Principal:
        caller = await iam.ResolveCaller(iam_pb2.ResolveCallerRequest())
        return Principal(
            user_id=user,
            platform_admin=caller.platform_admin,
            teams=tuple(
                Team(id=t.team_id, admin=t.role == iam_pb2.TEAM_ROLE_ADMIN) for t in caller.teams
            ),
        )

    return resolve
