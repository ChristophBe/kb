package server

import (
	"slices"
	"strconv"
	"strings"

	documentv1 "github.com/ChristophBe/knowcelium/modules/document/api/go/documentv1"
)

// rrfK is the constant of reciprocal rank fusion: an item at rank r (from 1)
// of a list earns 1/(rrfK+r). 60 is the value the method's authors found to
// work across collections; it keeps one list's top hit from drowning the other.
const rrfK = 60

// poolFactor is how many candidates each path contributes per result wanted:
// fusion needs ranks beyond the cut to credit items both paths know.
const poolFactor = 3

// rrf is the credit of the item at rank (counted from 0) of one list.
func rrf(rank int) float64 { return 1 / float64(rrfK+rank+1) }

// textQuery turns the user's text into a websearch query that matches a chunk
// containing any of its words: a question with a rare name in it should find
// the chunk of the name, not require the chunk to contain every word.
// Websearch operators (quotes, a leading minus, "or") are neutralised, so what
// the user types is always read as plain words. It is empty when there are none.
func textQuery(query string) string {
	words := strings.Fields(strings.NewReplacer(`"`, " ", "(", " ", ")", " ").Replace(query))
	kept := words[:0]
	for _, w := range words {
		w = strings.TrimLeft(w, "-")
		if w != "" && !strings.EqualFold(w, "or") {
			kept = append(kept, w)
		}
	}
	return strings.Join(kept, " or ")
}

// fused is an item with its summed reciprocal rank credit; first is the
// position of its first sighting, which breaks ties stably.
type fused[T any] struct {
	item  T
	score float64
	first int
}

// fuse merges ranked lists by reciprocal rank fusion: items with the same key
// are one item that earns the credit of each list it is in. seen is called for
// every sighting after the first, so the caller can combine the two.
func fuse[T any](key func(T) string, lists [][]T, seen func(have, got T, list int)) []*fused[T] {
	byKey := map[string]*fused[T]{}
	var order []*fused[T]
	for li, list := range lists {
		for rank, item := range list {
			f, ok := byKey[key(item)]
			if !ok {
				f = &fused[T]{item: item, first: len(order)}
				byKey[key(item)] = f
				order = append(order, f)
			} else {
				seen(f.item, item, li)
			}
			f.score += rrf(rank)
		}
	}
	slices.SortStableFunc(order, func(a, b *fused[T]) int {
		switch {
		case a.score > b.score:
			return -1
		case a.score < b.score:
			return 1
		}
		return a.first - b.first
	})
	return order
}

// fuseChunks merges the chunks found by meaning and by words into one list by
// reciprocal rank fusion and keeps the first limit. A chunk both paths found
// keeps its words' excerpt; a score is always the chunk's cosine similarity.
func fuseChunks(byVector, byText []*documentv1.ScoredChunk, limit int) []*documentv1.ScoredChunk {
	key := func(c *documentv1.ScoredChunk) string {
		return c.GetChunk().GetDocumentId() + "/" + strconv.Itoa(int(c.GetChunk().GetIndex()))
	}
	merged := fuse(key, [][]*documentv1.ScoredChunk{byVector, byText}, func(have, got *documentv1.ScoredChunk, _ int) {
		have.Excerpt, have.KeywordMatch = got.GetExcerpt(), got.GetKeywordMatch()
	})
	out := make([]*documentv1.ScoredChunk, 0, min(limit, len(merged)))
	for _, f := range merged[:min(limit, len(merged))] {
		out = append(out, f.item)
	}
	return out
}

// fuseDocuments merges the documents found by meaning and by words, each with
// its best chunk of that path, by reciprocal rank fusion. A document the words
// found shows the chunk that contains them (the reader sees why it matched);
// its score stays the better cosine similarity of the two chunks.
func fuseDocuments(byVector, byText []*documentv1.ScoredDocument, limit int) []*documentv1.ScoredDocument {
	merged := fuse((*documentv1.ScoredDocument).GetDocumentId, [][]*documentv1.ScoredDocument{byVector, byText},
		func(have, got *documentv1.ScoredDocument, _ int) {
			have.Score = max(have.GetScore(), got.GetScore())
			have.BestChunk, have.Excerpt, have.KeywordMatch = got.GetBestChunk(), got.GetExcerpt(), got.GetKeywordMatch()
		})
	out := make([]*documentv1.ScoredDocument, 0, min(limit, len(merged)))
	for _, f := range merged[:min(limit, len(merged))] {
		out = append(out, f.item)
	}
	return out
}
