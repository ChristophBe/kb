-- +goose Up
-- version counts the files a document has had; every document so far is on
-- its first. The pending_* columns hold a new file from ReplaceContent until
-- it has been processed and becomes the current one (object_key, filename,
-- ...). pending_status 0 (DOCUMENT_STATUS_UNSPECIFIED) means there is none;
-- otherwise it is that file's DocumentStatus.
ALTER TABLE document.documents
    ADD COLUMN version               integer  NOT NULL DEFAULT 1,
    ADD COLUMN pending_status        smallint NOT NULL DEFAULT 0,
    ADD COLUMN pending_status_detail text     NOT NULL DEFAULT '',
    ADD COLUMN pending_object_key    text     NOT NULL DEFAULT '',
    ADD COLUMN pending_filename      text     NOT NULL DEFAULT '',
    ADD COLUMN pending_content_type  text     NOT NULL DEFAULT '',
    ADD COLUMN pending_size_bytes    bigint   NOT NULL DEFAULT 0,
    ADD COLUMN pending_sha256        text     NOT NULL DEFAULT '';

-- The cleanup sweeper looks pending files up by key, like current ones.
CREATE INDEX documents_pending_object_key_idx ON document.documents (pending_object_key)
    WHERE pending_object_key <> '';

-- +goose Down
DROP INDEX document.documents_pending_object_key_idx;
ALTER TABLE document.documents
    DROP COLUMN pending_sha256,
    DROP COLUMN pending_size_bytes,
    DROP COLUMN pending_content_type,
    DROP COLUMN pending_filename,
    DROP COLUMN pending_object_key,
    DROP COLUMN pending_status_detail,
    DROP COLUMN pending_status,
    DROP COLUMN version;
