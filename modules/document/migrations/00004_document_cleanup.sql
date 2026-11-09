-- +goose Up
-- The cleanup sweeper looks documents up by object key, to find objects
-- without one, and by status and age, to find uploads that never completed.
CREATE INDEX documents_object_key_idx ON document.documents (object_key);
CREATE INDEX documents_status_created_at_idx ON document.documents (status, created_at);

-- +goose Down
DROP INDEX document.documents_status_created_at_idx;
DROP INDEX document.documents_object_key_idx;
