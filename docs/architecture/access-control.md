# Access control

Who may see and change what, and how the services find out. Users, teams and roles live in the `iam` module ([ADR 0013](../adr/0013-iam-module.md)); the other modules enforce access with a caller context they resolve from it. The end-user view is in the manual: [Teams](../user-manual/teams.md), [Sharing documents](../user-manual/sharing-documents.md), [Users](../user-manual/users.md), [Models](../user-manual/models.md).

## Access matrix

"Owner" is the user who added the document. A platform admin is a user flagged in `iam.users`; the first ones come from `KNOWCEL_IAM_BOOTSTRAP_ADMINS`, applied when a user is first seen, and further ones are designated on the Users page.

| Resource | Owner / creator | Team admin | Team member | Platform admin | Other users |
|---|---|---|---|---|---|
| Document content, search, chat citations | full | read (public, or attached to their team) | read (public, or attached to their team) | read public only | read public only |
| Document access and teams (`SetDocumentAccess`, `SetDocumentTeams`) | change access (public or team) and the teams of a team document, attaching own teams only | remove their own team only | none | none | none |
| Update, replace, reindex, delete a document | owner only | none | none | none | none |
| Conversations, ingestion jobs | own only | none | none | none | none |
| Team | creator becomes first admin | rename, delete, manage members and roles | read team and members, leave | none beyond their own teams | create a team |
| Users directory, platform admin flag | self (`GetCurrentUser`) | none | none | list users, promote and demote | self |
| Models and providers | read | read | read | read, pull, delete | read |

Platform admins get no extra content access: like anyone else they see public documents, and team documents only as owner or team member. The epic for this module also planned a platform-admin view of all teams and of token usage; neither exists today.

## Team rules

- Any registered user can create a team and becomes its admin. Roles are `TEAM_ROLE_ADMIN` and `TEAM_ROLE_MEMBER`.
- Only admins rename or delete a team, add members (by the email of a user who has signed in at least once), remove members and change roles. A member can leave.
- A team always keeps one admin: removing, demoting or leaving as the last admin fails with `FAILED_PRECONDITION` (reason `LAST_ADMIN`). The same holds for platform admins (`LAST_PLATFORM_ADMIN`). Both checks run under a row lock so two concurrent demotions cannot both succeed.
- A non-member gets `NOT_FOUND` for a team, so team ids don't leak; a member who is not an admin gets `PERMISSION_DENIED` on admin actions.
- Deleting a team deletes its memberships. The `document_teams` rows that referenced it stay, but match nobody (team ids are not reused), so a team document with no other team is visible only to its owner.

## Document visibility

The `document` module owns access: `document.documents.access` is `PUBLIC` (1, the default, also for everything that existed before the column) or `TEAM` (2), and the teams of a `TEAM` document are in `document.document_teams(document_id, team_id)`. There is no owner-only level. Visibility is `access = PUBLIC OR owner_id = caller OR a team of the document is among the caller's teams`, applied in the queries behind list, get, search, `ListChunks`, download and `SearchChunks` (`modules/document/service/queries/{documents,chunks}.sql`). Changes take effect on the next call, subject to the team cache below.

- **Access at creation:** an unset `access` is `PUBLIC` and takes no teams (`INVALID_ARGUMENT` on field `team_ids` otherwise); `TEAM` needs at least one team. While IAM is down a `TEAM` document fails with `UNAVAILABLE` (reason `TEAMS_UNAVAILABLE`), because the caller's teams are not known.
- **Sharing** (`modules/document/service/internal/server/teams.go`): `SetDocumentTeams` applies to `TEAM` documents only (`FAILED_PRECONDITION` for a public one). The owner shares only with teams they belong to (otherwise `NOT_FOUND`, reason `TEAM_NOT_FOUND`) and may stop sharing with any team. Anyone else who can see the document may only remove a team they administer; adding teams or removing someone else's gives `PERMISSION_DENIED` (reason `SHARING_NOT_ALLOWED`).
- **Changing access** (`SetDocumentAccess`): owner only (`PERMISSION_DENIED` for another reader, `NOT_FOUND` for one who can't read the document), with the same validation as at creation. It replaces the document's teams in one transaction, and public takes none.
- **Teams on a document:** the owner sees all of them, anyone else only those they belong to.
- **Upload:** ingestion passes `CreateUploadRequest.access` and `team_ids` to `CreateDocument` with the same rules; the UI asks for the access after the files are added and uploads only once it is confirmed. The teams are stored on the job so reprocessing and reindexing republish them. Replacing a document's file keeps its access.
- **Chat:** chat retrieves through `SearchChunks` as the caller, so citations come only from visible documents.
- **Chat by team:** a conversation can be limited to teams (`Conversation.team_ids`, empty means everything the caller can read). Chat checks that the caller belongs to each team (`PERMISSION_DENIED` otherwise, `UNAVAILABLE` while the caller's teams are unknown), resolving them through its own `PrincipalResolver` over IAM. At answer time the chosen teams are cut down to the caller's current ones, so a deleted team or one the caller left drops out and none left means all documents; while the teams are unknown the choice stands. `SearchChunksRequest.team_ids` then keeps only documents attached to one of those teams, on top of the visibility rule, and leaves public documents out.
- **Internal calls** without a user, such as the ingestion worker's, are not filtered: a worker must process every document it is handed.

## Caller context

1. Envoy validates the token and sets `x-kb-user`, `x-kb-email` and `x-kb-name`, dropping any client-supplied values ([ADR 0009](../adr/0009-oidc-authentication-at-the-gateway.md)). Calls between services forward the user (`grpcserver.Dial`, `knowcel_platform.grpc.channel`).
2. A module that needs teams or the admin flag builds a resolver over IAM's generated client, passes it to the server (`grpcserver.Principals(r)`, `serve(..., principals=...)`) and reads the `Principal` in handlers (`PrincipalFromContext`, `current_principal()`). `platform/` stays free of module imports: the resolver is injected. `document` and `llm` wire one.
3. The resolver calls `IamService.ResolveCaller`, an internal RPC that Envoy does not route. It returns the user's team ids with roles and the admin flag; an unregistered user has no teams and no rights.

Principals are cached for 30 s (`DefaultPrincipalTTL`), so team and role changes reach other modules within that time. A lookup is bounded at 2 s. A failed lookup is cached for 5 s; one that failed only because the caller's own call ended is not cached.

## When IAM is down

Peers treat `iam` as a soft dependency: no compose `depends_on`, and `depends_on: [iam]` in `module.yaml` only declares the client. What happens today while it is unreachable:

- **Public and own documents keep working.** The principal has no teams and no admin rights and is marked `Unavailable`.
- **Team documents of others disappear** from lists, search and chat for non-owners, after their cached principal expires (up to 30 s), and reappear within 5 s of IAM returning.
- **Creating a team document and sharing with a team** fail with `UNAVAILABLE` (reason `TEAMS_UNAVAILABLE`) instead of `NOT_FOUND`, because the principal records that the lookup failed.
- **`PullModel` and `DeleteModel`** fail closed with `PERMISSION_DENIED`; listing models still works.
- **The UI** offers only **Public** when uploading, hides team names and the Share controls and labels team documents **Team**; the Teams and Users pages fail because they call IAM directly.

`Principal.Unavailable` (Go, `platform/go/grpcserver`) and `Principal.unavailable` (Python, `knowcel_platform.grpc`) are set by the resolvers. Chat refuses to set a team scope with `UNAVAILABLE` while it is true.
