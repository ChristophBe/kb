//go:build integration

package store

import (
	"slices"
	"testing"

	"github.com/google/uuid"
	"github.com/pgvector/pgvector-go"
)

func chunkOf(doc uuid.UUID, idx int32, text, embeddingModel string, embedding []float32) InsertChunksParams {
	c := chunk(doc, idx, text, embedding)
	c.EmbeddingModel = embeddingModel
	return c
}

// Vectors of different models are not comparable, even when they have the
// same dimension: a search sees only the chunks of the query's model.
func TestSearchesNeverCompareVectorsOfDifferentModels(t *testing.T) {
	r := newRepo(t)
	ctx := t.Context()
	oldDoc, newDoc := newDocument(t, r, "old.md"), newDocument(t, r, "new.md")
	// The old model's chunk is the nearest to the query by distance.
	if _, err := r.ReplaceChunks(ctx, oldDoc, []InsertChunksParams{chunkOf(oldDoc, 0, "old model", "model-a", axis(0))}, readyStatus); err != nil {
		t.Fatal(err)
	}
	if _, err := r.ReplaceChunks(ctx, newDoc, []InsertChunksParams{chunkOf(newDoc, 0, "new model", "model-b", axis(1))}, readyStatus); err != nil {
		t.Fatal(err)
	}
	query := pgvector.NewVector(axis(0))
	for modelName, want := range map[string]uuid.UUID{"model-a": oldDoc, "model-b": newDoc} {
		rows, err := r.SearchChunks(ctx, SearchChunksParams{Embedding: query, OwnerID: owner, EmbeddingModel: modelName, DocumentIds: []uuid.UUID{}, MaxResults: 10})
		if err != nil {
			t.Fatal(err)
		}
		if len(rows) != 1 || rows[0].DocumentID != want {
			t.Errorf("SearchChunks %s = %+v, want only %s's chunk", modelName, rows, want)
		}
		best, err := r.SearchBestChunks(ctx, SearchBestChunksParams{Embedding: query, OwnerID: owner, EmbeddingModel: modelName, DocumentIds: []uuid.UUID{}, MaxResults: 10})
		if err != nil {
			t.Fatal(err)
		}
		if len(best) != 1 || best[0].DocumentID != want {
			t.Errorf("SearchBestChunks %s = %+v, want only %s's document", modelName, best, want)
		}
	}
	rows, err := r.SearchChunks(ctx, SearchChunksParams{Embedding: query, OwnerID: owner, EmbeddingModel: "model-c", DocumentIds: []uuid.UUID{}, MaxResults: 10})
	if err != nil || len(rows) != 0 {
		t.Errorf("a model without chunks finds %+v, %v", rows, err)
	}
}

func TestChunksRecordTheirModelAndDimensions(t *testing.T) {
	r := newRepo(t)
	doc := newDocument(t, r, "a.md")
	if _, err := r.ReplaceChunks(t.Context(), doc, []InsertChunksParams{chunkOf(doc, 0, "a", "model-a", axis(0))}, readyStatus); err != nil {
		t.Fatal(err)
	}
	var gotModel string
	var gotDims int32
	err := r.pool.QueryRow(t.Context(),
		"SELECT embedding_model, embedding_dimensions FROM document.chunks WHERE document_id = $1", doc).Scan(&gotModel, &gotDims)
	if err != nil || gotModel != "model-a" || gotDims != dimensions {
		t.Errorf("model %q, dimensions %d, err %v", gotModel, gotDims, err)
	}
}

// A document is reindexed when any chunk is of another model; its old chunks
// stay searchable by the old model until ReplaceChunks swaps them.
func TestListReindexTargetsFindsDocumentsOnAnotherModel(t *testing.T) {
	r := newRepo(t)
	ctx := t.Context()
	oldDoc, current, failed, replacing := newDocument(t, r, "old.md"), newDocument(t, r, "cur.md"), newDocument(t, r, "failed.md"), newDocument(t, r, "replacing.md")
	theirs := newOwnedDocument(t, r, "bob", "theirs.md")
	for doc, m := range map[uuid.UUID]string{oldDoc: "model-a", current: "model-b", theirs: "model-a", replacing: "model-a"} {
		if _, err := r.ReplaceChunks(ctx, doc, []InsertChunksParams{chunkOf(doc, 0, "x", m, axis(0))}, readyStatus); err != nil {
			t.Fatal(err)
		}
	}
	_ = failed // never processed: no chunks, not READY
	// replacing has a new version in flight.
	doc, err := r.GetAnyDocument(ctx, replacing)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := startPending(t, r, doc, "k2"); err != nil {
		t.Fatal(err)
	}

	list := func(force bool, ids ...uuid.UUID) []uuid.UUID {
		t.Helper()
		if ids == nil {
			ids = []uuid.UUID{}
		}
		got, err := r.ListReindexTargets(ctx, ListReindexTargetsParams{OwnerID: owner, DocumentIds: ids, Force: force, EmbeddingModel: "model-b"})
		if err != nil {
			t.Fatal(err)
		}
		return got
	}
	if got := list(false); !slices.Equal(got, []uuid.UUID{oldDoc}) {
		t.Errorf("outdated = %v, want only the document on model-a", got)
	}
	if got := list(true); !slices.Equal(got, []uuid.UUID{oldDoc, current}) {
		t.Errorf("forced = %v, want every ready document of alice without a pending version", got)
	}
	if got := list(true, current); !slices.Equal(got, []uuid.UUID{current}) {
		t.Errorf("limited = %v", got)
	}
	if got := list(false, current); len(got) != 0 {
		t.Errorf("a document on the current model = %v", got)
	}
	// After the swap the document is on the new model.
	if _, err := r.ReplaceChunks(ctx, oldDoc, []InsertChunksParams{chunkOf(oldDoc, 0, "x", "model-b", axis(0))}, readyStatus); err != nil {
		t.Fatal(err)
	}
	if got := list(false); len(got) != 0 {
		t.Errorf("after reindexing = %v", got)
	}
}
