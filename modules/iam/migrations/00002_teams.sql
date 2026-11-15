-- +goose Up
CREATE TABLE iam.teams (
    id         uuid        PRIMARY KEY,
    name       text        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- role holds the knowcel.iam.v1.TeamRole value (1 admin, 2 member). A team
-- always keeps at least one admin; the service enforces that in a transaction.
CREATE TABLE iam.team_members (
    team_id    uuid        NOT NULL REFERENCES iam.teams (id) ON DELETE CASCADE,
    user_id    text        NOT NULL REFERENCES iam.users (id) ON DELETE CASCADE,
    role       smallint    NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, user_id)
);
CREATE INDEX team_members_user_idx ON iam.team_members (user_id);

-- +goose Down
DROP TABLE iam.team_members;
DROP TABLE iam.teams;
