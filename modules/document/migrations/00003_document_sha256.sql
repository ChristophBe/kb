-- +goose Up
-- sha256 is the checksum the client declared when creating the document, in
-- lowercase hex; marking the upload done checks the stored file against it.
-- Empty when none was declared, as for all documents from before.
ALTER TABLE document.documents ADD COLUMN sha256 text NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE document.documents DROP COLUMN sha256;
