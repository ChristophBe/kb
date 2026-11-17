package server

import (
	"slices"
	"strconv"
	"testing"

	documentv1 "github.com/ChristophBe/knowcelium/modules/document/api/go/documentv1"
)

func TestTextQuery(t *testing.T) {
	for in, want := range map[string]string{
		"":                        "",
		"   ":                     "",
		"ERR-4711":                "ERR-4711",
		"refund policy":           "refund or policy",
		`say "hello" -world or x`: "say or hello or world or x",
		"(a) OR (b)":              "a or b",
		"-":                       "",
	} {
		if got := textQuery(in); got != want {
			t.Errorf("textQuery(%q) = %q, want %q", in, got, want)
		}
	}
}

func chunk(doc string, idx int32) *documentv1.ScoredChunk {
	return &documentv1.ScoredChunk{Chunk: &documentv1.Chunk{DocumentId: doc, Index: idx}}
}

func chunkKeys(chunks []*documentv1.ScoredChunk) []string {
	var out []string
	for _, c := range chunks {
		out = append(out, c.GetChunk().GetDocumentId()+"/"+strconv.Itoa(int(c.GetChunk().GetIndex())))
	}
	return out
}

func TestFuseChunksRewardsItemsBothPathsFind(t *testing.T) {
	byVector := []*documentv1.ScoredChunk{chunk("a", 0), chunk("b", 0), chunk("c", 0)}
	hit := chunk("c", 0)
	hit.Excerpt, hit.KeywordMatch = "the c words", true
	byText := []*documentv1.ScoredChunk{chunk("d", 1), hit}
	got := fuseChunks(byVector, byText, 4)
	// a: 1/61, b: 1/62, c: 1/63 + 1/62, d: 1/61.
	if want := []string{"c/0", "a/0", "d/1", "b/0"}; !slices.Equal(chunkKeys(got), want) {
		t.Fatalf("order = %v, want %v", chunkKeys(got), want)
	}
	if got[0].GetExcerpt() != "the c words" || !got[0].GetKeywordMatch() {
		t.Errorf("chunk found by both lost its excerpt: %v", got[0])
	}
	if cut := fuseChunks(byVector, byText, 2); len(cut) != 2 {
		t.Errorf("limit not applied: %v", chunkKeys(cut))
	}
}

func TestFuseChunksWithoutWordMatches(t *testing.T) {
	byVector := []*documentv1.ScoredChunk{chunk("a", 0), chunk("b", 0)}
	if got := fuseChunks(byVector, nil, 5); !slices.Equal(chunkKeys(got), []string{"a/0", "b/0"}) {
		t.Errorf("order = %v, want the vector order", chunkKeys(got))
	}
}

func TestFuseDocumentsShowsTheChunkWithTheWords(t *testing.T) {
	byVector := []*documentv1.ScoredDocument{
		{DocumentId: "a", Score: 0.9, BestChunk: &documentv1.Chunk{Index: 0}},
		{DocumentId: "b", Score: 0.5, BestChunk: &documentv1.Chunk{Index: 1}},
	}
	byText := []*documentv1.ScoredDocument{
		{DocumentId: "b", Score: 0.2, BestChunk: &documentv1.Chunk{Index: 7}, Excerpt: "words", KeywordMatch: true},
	}
	got := fuseDocuments(byVector, byText, 5)
	if len(got) != 2 || got[0].GetDocumentId() != "b" {
		t.Fatalf("documents = %v, want b (found by both) first", got)
	}
	if b := got[0]; b.GetBestChunk().GetIndex() != 7 || b.GetExcerpt() != "words" || b.GetScore() != 0.5 || !b.GetKeywordMatch() {
		t.Errorf("b = %v, want the chunk with the words and the better score", b)
	}
}
