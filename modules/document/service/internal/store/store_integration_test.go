//go:build integration

package store

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pgvector/pgvector-go"
	pgxvec "github.com/pgvector/pgvector-go/pgx"

	"github.com/christoph/kb/modules/document/migrations"
	"github.com/christoph/kb/platform/go/postgres/pgtest"
)

const (
	dimensions  = 768
	readyStatus = 4
)

func newRepo(t *testing.T) *Repo {
	t.Helper()
	return NewRepo(pgtest.Start(t, "document", migrations.FS, func(c *pgxpool.Config) {
		c.AfterConnect = pgxvec.RegisterTypes
	}))
}

// axis returns a vector along one dimension; axes are orthogonal, and blend
// moves one towards another, so the distances in a test are known exactly.
func axis(i int) []float32 {
	v := make([]float32, dimensions)
	v[i] = 1
	return v
}

func blend(a, b []float32, weight float32) []float32 {
	v := make([]float32, dimensions)
	for i := range v {
		v[i] = (1-weight)*a[i] + weight*b[i]
	}
	return v
}

func newDocument(t *testing.T, r *Repo, title string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := r.CreateDocument(context.Background(), CreateDocumentParams{
		ID: id, Title: title, Filename: title, ContentType: "text/plain", ObjectKey: id.String(),
		Status: 1, Metadata: map[string]string{},
	}); err != nil {
		t.Fatal(err)
	}
	return id
}

func chunk(doc uuid.UUID, idx int32, text string, embedding []float32) InsertChunksParams {
	return InsertChunksParams{
		DocumentID: doc, Idx: idx, Text: text, Metadata: map[string]string{"heading": text},
		Embedding: pgvector.NewVector(embedding),
	}
}

func search(t *testing.T, r *Repo, query []float32, limit int32, docs ...uuid.UUID) []SearchChunksRow {
	t.Helper()
	if docs == nil {
		docs = []uuid.UUID{}
	}
	rows, err := r.SearchChunks(t.Context(), SearchChunksParams{
		Embedding: pgvector.NewVector(query), DocumentIds: docs, MaxResults: limit,
	})
	if err != nil {
		t.Fatal(err)
	}
	return rows
}

func TestReplaceChunksSwapsChunksAndMarksTheDocumentReady(t *testing.T) {
	r := newRepo(t)
	doc := newDocument(t, r, "a.md")
	ctx := t.Context()

	n, err := r.ReplaceChunks(ctx, doc, []InsertChunksParams{
		chunk(doc, 0, "old 0", axis(0)), chunk(doc, 1, "old 1", axis(1)), chunk(doc, 2, "old 2", axis(2)),
	}, readyStatus)
	if err != nil || n != 3 {
		t.Fatalf("first replace: n = %d, err = %v", n, err)
	}
	n, err = r.ReplaceChunks(ctx, doc, []InsertChunksParams{chunk(doc, 0, "new", axis(3))}, readyStatus)
	if err != nil || n != 1 {
		t.Fatalf("second replace: n = %d, err = %v", n, err)
	}

	rows := search(t, r, axis(3), 10)
	if len(rows) != 1 || rows[0].Text != "new" {
		t.Fatalf("chunks after replace = %+v", rows)
	}
	if rows[0].Metadata["heading"] != "new" {
		t.Errorf("metadata = %v", rows[0].Metadata)
	}
	got, err := r.GetDocument(ctx, doc)
	if err != nil {
		t.Fatal(err)
	}
	if got.ChunkCount != 1 || got.Status != readyStatus {
		t.Errorf("document: chunk count %d, status %d", got.ChunkCount, got.Status)
	}
}

func TestReplaceChunksKeepsTheOldChunksWhenInsertingFails(t *testing.T) {
	r := newRepo(t)
	doc := newDocument(t, r, "a.md")
	ctx := t.Context()
	if _, err := r.ReplaceChunks(ctx, doc, []InsertChunksParams{chunk(doc, 0, "old", axis(0))}, readyStatus); err != nil {
		t.Fatal(err)
	}

	// The wrong dimension is rejected by the vector column.
	bad := InsertChunksParams{DocumentID: doc, Idx: 0, Text: "bad", Metadata: map[string]string{}, Embedding: pgvector.NewVector([]float32{1})}
	if _, err := r.ReplaceChunks(ctx, doc, []InsertChunksParams{bad}, readyStatus); err == nil {
		t.Fatal("want an error for the wrong dimension")
	}

	if rows := search(t, r, axis(0), 10); len(rows) != 1 || rows[0].Text != "old" {
		t.Errorf("chunks after failed replace = %+v", rows)
	}
}

func TestSearchChunksReturnsNearestChunksInOrder(t *testing.T) {
	r := newRepo(t)
	doc := newDocument(t, r, "a.md")
	query := axis(0)
	if _, err := r.ReplaceChunks(t.Context(), doc, []InsertChunksParams{
		chunk(doc, 0, "far", axis(5)),
		chunk(doc, 1, "nearest", query),
		chunk(doc, 2, "near", blend(query, axis(1), 0.2)),
		chunk(doc, 3, "middle", blend(query, axis(1), 0.7)),
	}, readyStatus); err != nil {
		t.Fatal(err)
	}

	rows := search(t, r, query, 3)
	got := make([]string, 0, len(rows))
	for _, row := range rows {
		got = append(got, row.Text)
	}
	if want := []string{"nearest", "near", "middle"}; len(got) != 3 || got[0] != want[0] || got[1] != want[1] || got[2] != want[2] {
		t.Fatalf("order = %v, want %v", got, want)
	}
	if rows[0].Score < 0.999 || rows[0].Score <= rows[1].Score || rows[1].Score <= rows[2].Score {
		t.Errorf("scores = %v, %v, %v", rows[0].Score, rows[1].Score, rows[2].Score)
	}
	if rows[0].DocumentTitle != "a.md" {
		t.Errorf("title = %q", rows[0].DocumentTitle)
	}
}

func TestSearchChunksCanBeLimitedToDocuments(t *testing.T) {
	r := newRepo(t)
	first, second := newDocument(t, r, "a.md"), newDocument(t, r, "b.md")
	ctx := t.Context()
	if _, err := r.ReplaceChunks(ctx, first, []InsertChunksParams{chunk(first, 0, "in a", axis(0))}, readyStatus); err != nil {
		t.Fatal(err)
	}
	if _, err := r.ReplaceChunks(ctx, second, []InsertChunksParams{chunk(second, 0, "in b", axis(1))}, readyStatus); err != nil {
		t.Fatal(err)
	}

	if rows := search(t, r, axis(0), 10); len(rows) != 2 {
		t.Errorf("no filter: %d rows", len(rows))
	}
	rows := search(t, r, axis(0), 10, second)
	if len(rows) != 1 || rows[0].Text != "in b" {
		t.Errorf("filtered: %+v", rows)
	}
}

func TestListChunksPagesInIndexOrderWithinADocument(t *testing.T) {
	r := newRepo(t)
	ctx := t.Context()
	doc, other := newDocument(t, r, "a"), newDocument(t, r, "b")
	// Inserted out of order, so the result order comes from the query.
	if _, err := r.ReplaceChunks(ctx, doc, []InsertChunksParams{
		chunk(doc, 2, "two", axis(2)), chunk(doc, 0, "zero", axis(0)), chunk(doc, 1, "one", axis(1)),
	}, readyStatus); err != nil {
		t.Fatal(err)
	}
	if _, err := r.ReplaceChunks(ctx, other, []InsertChunksParams{chunk(other, 0, "elsewhere", axis(3))}, readyStatus); err != nil {
		t.Fatal(err)
	}
	texts := func(after, limit int32) []string {
		rows, err := r.ListChunks(ctx, ListChunksParams{DocumentID: doc, AfterIdx: after, MaxResults: limit})
		if err != nil {
			t.Fatal(err)
		}
		out := []string{}
		for _, row := range rows {
			if row.Metadata["heading"] != row.Text {
				t.Errorf("metadata = %v", row.Metadata)
			}
			out = append(out, row.Text)
		}
		return out
	}
	if got := texts(-1, 2); len(got) != 2 || got[0] != "zero" || got[1] != "one" {
		t.Errorf("first page = %v", got)
	}
	if got := texts(1, 2); len(got) != 1 || got[0] != "two" {
		t.Errorf("second page = %v", got)
	}
}
