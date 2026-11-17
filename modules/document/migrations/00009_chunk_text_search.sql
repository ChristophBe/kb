-- +goose Up
-- The full-text half of hybrid search: a vector alone misses exact terms such
-- as names, ids and code identifiers. The column is generated, so existing
-- chunks are covered and no writer has to know about it. The 'english'
-- configuration drops common English words and stems, and leaves other words
-- and identifiers as they are; queries must use the same configuration.
ALTER TABLE document.chunks
    ADD COLUMN text_search tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED;
CREATE INDEX chunks_text_search_idx ON document.chunks USING gin (text_search);

-- +goose Down
DROP INDEX document.chunks_text_search_idx;
ALTER TABLE document.chunks DROP COLUMN text_search;
