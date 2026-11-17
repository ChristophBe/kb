# Hybrid search

The document module searches chunks by meaning (pgvector, cosine similarity) and by words (PostgreSQL full text) and fuses both rankings. A vector alone misses exact terms such as names, ids and code identifiers: an embedding of `ERR-4711` sits next to other error codes, not next to the chunk that explains it.

## How it works

- **Full-text index.** `document.chunks.text_search` is a generated `tsvector` column (`to_tsvector('english', text)`) with a GIN index (migration `00009_chunk_text_search.sql`). `english` drops common English words and stems; other words and identifiers are kept as they are.
- **Two queries per search.** `SearchChunks`/`SearchBestChunks` rank by cosine similarity as before. `SearchTextChunks`/`SearchBestTextChunks` rank the chunks that contain any word of the query by `ts_rank_cd`. Words are joined by `or`, so a question with one rare name finds the chunk of the name (`textQuery` in `fusion.go` neutralises websearch operators).
- **Same visibility on both paths.** Each query repeats the visibility predicate (public, owned, or shared with one of the caller's teams, plus the optional `only_team_ids`) and the embedding-model filter, so a chunk the caller can't read is never returned by either path. Both paths take their candidates from the same set of documents; the tests check this per team.
- **Reciprocal rank fusion.** Each path contributes `3 x limit` candidates; an item at rank `r` earns `1/(60+r)` per list and the sums order the results (`fuse` in `fusion.go`). A chunk (or document) both paths know rises above one that only one knows.
- **Scores.** `ScoredChunk.score` stays the cosine similarity, also for chunks only the words found, so a consumer's similarity threshold keeps its meaning; the order follows the fusion. `keyword_match` marks chunks the words found, and `excerpt` is the fragment around the matched words (`ts_headline`, no markup). For a document found by words, `best_chunk` is the chunk that contains them.
- **Callers.** `SearchDocuments` always has the query text. `SearchChunks` takes an optional `query` next to the embedding; without it the search is vector-only, as before. Chat passes the question, cites `excerpt` when there is one, keeps `keyword_match` results below its minimum score and reranks on the whole chunk text.

## Evaluation

Fixture and test: `modules/document/service/internal/server/hybrid_integration_test.go` (`TestHybridSearchBeatsVectorSearchOnTheFixture`, run by `task test:integration` against real PostgreSQL). Ten one-chunk documents; each chunk's vector is one-hot on its topic, standing in for an embedding model. Eight queries: four exact terms (`ERR-4711`, `Okonkwo-Reyes`, `KNOWCEL_EMBEDDING_DIMENSIONS`, `INV-2024-0042`) that the stand-in model places on another topic than their chunk, one question that mixes an exact term with a misleading topic, and three paraphrases without a word in common with their chunk. The top 3 results are compared with the chunk that answers the query.

| | hit@1 | hit@3 | MRR |
|---|---|---|---|
| Before (vector only) | 3/8 | 5/8 | 0.48 |
| After (hybrid) | 6/8 | 8/8 | 0.88 |

Every exact-term query is found. The paraphrases still work through the vector path; one of them ("how do I get my money back") shows the cost of matching on any word: the unrelated chunk "roll back by redeploying…" shares the word "back" and ranks first, with the refund chunk second. The test fails when these numbers change, so an intended change updates this table too.

This is a regression fixture, not a benchmark of a real embedding model; the stand-in is deterministic so the numbers are stable.
