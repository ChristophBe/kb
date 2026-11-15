-- +goose Up
CREATE SCHEMA IF NOT EXISTS iam;

-- id is the subject of the user's OIDC token (the x-kb-user Envoy forwards),
-- so other modules' owner ids are user ids.
CREATE TABLE iam.users (
    id             text        PRIMARY KEY,
    email          text        NOT NULL DEFAULT '',
    display_name   text        NOT NULL DEFAULT '',
    platform_admin boolean     NOT NULL DEFAULT false,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);
-- Members are added by email, case-insensitively.
CREATE INDEX users_email_idx ON iam.users (lower(email));

-- +goose Down
DROP SCHEMA iam CASCADE;
