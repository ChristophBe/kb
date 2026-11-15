-- +goose Up
-- The teams a document is shared with. team_id is an iam.teams id; the iam
-- module owns teams, so there is no foreign key, and a deleted team's rows
-- stay (harmlessly) until the document is unshared or deleted.
CREATE TABLE document.document_teams (
    document_id uuid NOT NULL REFERENCES document.documents (id) ON DELETE CASCADE,
    team_id     uuid NOT NULL,
    PRIMARY KEY (document_id, team_id)
);

-- Visibility looks documents up by the caller's teams.
CREATE INDEX document_teams_team_idx ON document.document_teams (team_id);

-- +goose Down
DROP TABLE document.document_teams;
