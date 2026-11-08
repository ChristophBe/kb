-- +goose Up
-- owner_id is the subject of the user who uploaded the document (the
-- x-kb-user Envoy forwards from the verified token); users only see their own
-- documents. Documents from before ownership go to the dev Dex user alice
-- (deploy/dex), so local data stays visible when signing in as her.
ALTER TABLE document.documents ADD COLUMN owner_id text NOT NULL DEFAULT 'CgVhbGljZRIFbG9jYWw';
ALTER TABLE document.documents ALTER COLUMN owner_id DROP DEFAULT;

-- Listing is per owner now, so the index leads with it.
DROP INDEX document.documents_created_at_idx;
CREATE INDEX documents_owner_created_at_idx ON document.documents (owner_id, created_at DESC, id DESC);

-- +goose Down
DROP INDEX document.documents_owner_created_at_idx;
CREATE INDEX documents_created_at_idx ON document.documents (created_at DESC, id DESC);
ALTER TABLE document.documents DROP COLUMN owner_id;
