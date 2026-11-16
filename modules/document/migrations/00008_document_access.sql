-- +goose Up
-- access is the document's DocumentAccess: 1 (PUBLIC) is visible to every
-- signed-in user, 2 (TEAM) to its owner and the members of its document_teams.
-- Every document so far becomes public, and the teams it was shared with are
-- dropped: document_teams only holds the teams of TEAM documents.
ALTER TABLE document.documents ADD COLUMN access smallint NOT NULL DEFAULT 1;
DELETE FROM document.document_teams;

-- Listing reads the public documents in order, next to the owner's and the teams'.
CREATE INDEX documents_public_created_at_idx ON document.documents (created_at DESC, id DESC)
    WHERE access = 1;

-- +goose Down
DROP INDEX document.documents_public_created_at_idx;
ALTER TABLE document.documents DROP COLUMN access;
