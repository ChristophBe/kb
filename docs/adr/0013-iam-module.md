# 0013. Keep users, teams and roles in an `iam` module

- Status: Accepted
- Date: 2026-11-15

## Context

Services only see the subject of the caller's token (`x-kb-user`, [ADR 0009](0009-oidc-authentication-at-the-gateway.md)). There is no registry of users, so there is nothing to put into a team, no way to find a person by email and no one who can be a platform admin. Documents are private to their owner; sharing them with teams needs teams and roles somewhere. Options considered:

- **Read everything from the token**: no state, but a token carries no teams, members can't be added before they have signed in, and every IdP would have to be configured with our roles.
- **Put users and teams into `document`**: no new component, but conversations, models and other modules need the same answers, and `document` would become the owner of identity.
- **A separate `iam` module**: one place that owns users, teams and roles; the others ask it through its gRPC client and treat it as a soft dependency ([module architecture](../architecture/module.md#talking-to-other-modules)).

## Decision

We will add an `iam` module (`modules/iam`, Go, schema `iam`, `iam-service` on port 9006, metrics 9106) that owns the registry of users, and later the teams and roles built on it.

- **Identity is the subject.** `iam.users.id` is the token's subject, the id other modules already store as `owner_id`. IAM does not issue ids of its own.
- **Registration on first sight.** `IamService.GetCurrentUser` upserts the caller: it creates the user on their first call and refreshes email and display name on later ones (a claim the token lacks keeps the stored value).
- **Claims reach services as headers.** Besides `x-kb-user`, Envoy sets `x-kb-email` and `x-kb-name` from the token's `email` and `name` claims and drops client-supplied values. Only `iam` reads them for now.
- **First platform admins come from configuration.** `KNOWCEL_IAM_BOOTSTRAP_ADMINS` lists subjects or emails (comma-separated); a user matching an entry when first seen is flagged `platform_admin`. Adding an entry later does not promote a user who is already registered, and removing one demotes no one: further admins are designated in the product. Matching by email trusts the issuer to only put verified emails into the token.

## Consequences

- Teams, memberships and the admin directory build on `iam.users`; sharing in `document`, `ingestion`, `chat` and `llm` follows by resolving the caller's teams through IAM, which every other module treats as a soft dependency (`UNAVAILABLE` for team features while it is down, owner-only access keeps working).
- Every deployment needs at least one bootstrap admin, or no one can designate platform admins.
- The user registry only knows people who have signed in; adding a team member by email needs that person to have signed in once.
- Revisit if an IdP can't provide `email` and `name` claims as access-token claims, or if identities must be shared across several issuers (the subject is only unique per issuer).
