# 0009. Authenticate with OIDC tokens at the gateway

- Status: Accepted
- Date: 2026-11-08

## Context

Anyone who can reach Envoy can read and change all data. kb needs users, and later per-user data (#4). Options considered:

- **Authentication in every service**: each service validates tokens itself. Every language needs a JWT library, JWKS caching and the same configuration; a service that forgets it is open.
- **Authentication at the gateway**: Envoy's `jwt_authn` filter validates the token once for every routed call and forwards the subject. Services stay token-agnostic; they only trust a header that Envoy sets.
- **Dev identity provider**: Keycloak (heavy, slow to start, needs realm import), Dex (one small binary, static users and clients in a file), or an auth-off dev mode (a second code path that production never exercises).

## Decision

We will authenticate every browser-facing call at Envoy with an OIDC access token (JWT) from a configurable issuer (`KB_OIDC_ISSUER`, `KB_OIDC_JWKS_URL`, `KB_OIDC_AUDIENCES`). Calls without a valid token get `UNAUTHENTICATED`; CORS preflights and health checks are exempt. Envoy forwards the token's `sub` claim as the `x-kb-user` header and removes any `x-kb-user` sent by the client. The platform's gRPC servers (`platform/go/grpcserver`, `kb_platform.grpc`) put it into the request context (`UserFromContext`, `current_user()`).

For development and tests, compose runs Dex (`deploy/infra.compose.yaml`, `deploy/dex/config.yaml.tpl`) with static users and public clients, and the password grant enabled so tests and scripts fetch tokens without a browser. There is no auth-off mode.

## Consequences

- Services must only be reachable through Envoy or from other services: whoever can call a service directly can claim any user with `x-kb-user`. Compose publishes the service ports for development; production deployments must not.
- Calls between services carry no user yet; propagating it (#100, #101) and filtering data by owner (#4) build on the context accessors.
- The web shell needs a login (#99, authorization code with PKCE against the `kb-web` client) before it works again.
- Dex's `sub` is opaque (an encoding of user id and connector); services treat it as an id, not a name.
- Switching to another IdP is configuration only, as long as it issues JWT access tokens with a JWKS endpoint.
