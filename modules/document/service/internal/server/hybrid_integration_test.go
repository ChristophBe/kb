//go:build integration

package server

import (
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"

	documentv1 "github.com/ChristophBe/knowcelium/modules/document/api/go/documentv1"
)

// The fixture set of the hybrid search evaluation (docs/architecture/hybrid-search.md).
// A chunk's vector is one-hot on its topic, standing in for an embedding model:
// chunks of a topic are close to each other and far from the others. A query's
// topic is where the model puts the query. For the keyword queries it points at
// a different topic than the chunk that holds the word, which is how names, ids
// and identifiers behave in a real embedding.
var hybridFixture = struct {
	chunks  []fixtureChunk
	queries []fixtureQuery
}{
	chunks: []fixtureChunk{
		{"refund", 0, "Refund policy: customers may return products within 30 days for a full refund."},
		{"shipping", 1, "Shipping takes three to five working days within the EU."},
		{"vault", 2, "Error ERR-4711 means the vault is sealed; unseal it with the operator key."},
		{"rollback", 2, "Deployment runbook: roll back by redeploying the previous image tag."},
		{"contact", 3, "Contact Dr. Okonkwo-Reyes in the Lagos office for customs questions."},
		{"offices", 3, "Our offices are located in Berlin, Lagos and Toronto."},
		{"config", 4, "The KNOWCEL_EMBEDDING_DIMENSIONS setting must match the migration."},
		{"models", 4, "Set the language model through configuration variables."},
		{"revenue", 5, "Quarterly revenue grew twelve percent year over year."},
		{"invoice", 5, "Invoice INV-2024-0042 was paid on the third of March."},
	},
	queries: []fixtureQuery{
		// Exact terms the embedding places elsewhere.
		{"ERR-4711", 4, "vault"},
		{"Okonkwo-Reyes", 1, "contact"},
		{"KNOWCEL_EMBEDDING_DIMENSIONS", 2, "config"},
		{"INV-2024-0042", 3, "invoice"},
		{"what does ERR-4711 mean for the shipping", 1, "vault"},
		// Questions the words alone cannot answer.
		{"how do I get my money back", 0, "refund"},
		{"how fast does a parcel arrive", 1, "shipping"},
		{"how much did sales increase", 5, "revenue"},
	},
}

type fixtureChunk struct {
	name  string
	topic int
	text  string
}

type fixtureQuery struct {
	text  string
	topic int
	want  string // the name of the chunk that answers it
}

// fixtureRanking returns the names of the chunks a query finds, in result order,
// as bob (who reads the public documents) sees them.
func (h *teamHarness) fixtureRanking(t *testing.T, names map[string]string, q fixtureQuery, hybrid bool) []string {
	t.Helper()
	req := &documentv1.SearchChunksRequest{Embedding: oneHot(q.topic), EmbeddingModel: "test-model", Limit: 3}
	if hybrid {
		req.Query = q.text
	}
	resp, err := h.server.SearchChunks(asUser(t, bob, nil), req)
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, r := range resp.GetResults() {
		out = append(out, names[r.GetChunk().GetDocumentId()])
	}
	return out
}

// uploadFixture stores the fixture as public documents of one chunk each and
// returns each document's chunk name.
func (h *teamHarness) uploadFixture(t *testing.T) map[string]string {
	t.Helper()
	names := map[string]string{}
	for _, c := range hybridFixture.chunks {
		id := h.uploadChunk(t, c.text, oneHot(c.topic))
		names[id] = c.name
	}
	return names
}

// uploadChunk creates a public ready document of alice's holding one chunk.
func (h *teamHarness) uploadChunk(t *testing.T, text string, vec []float32, teams ...uuid.UUID) string {
	t.Helper()
	level := documentv1.Access_ACCESS_PUBLIC
	if len(teams) > 0 {
		level = documentv1.Access_ACCESS_TEAM
	}
	resp, err := h.server.CreateDocument(asUser(t, alice, teams), &documentv1.CreateDocumentRequest{
		Filename: "notes.md", SizeBytes: 1, Access: level, TeamIds: ids(teams),
	})
	if err != nil {
		t.Fatal(err)
	}
	id := resp.GetDocument().GetId()
	if _, err := h.server.AddChunks(t.Context(), &documentv1.AddChunksRequest{DocumentId: id, Chunks: []*documentv1.ChunkInput{
		{Index: 0, Text: text, Embedding: vec, EmbeddingModel: "test-model"},
	}}); err != nil {
		t.Fatal(err)
	}
	return id
}

// metrics are the usual ranking measures over the fixture queries.
type metrics struct {
	hit1, hit3 int
	mrr        float64
}

func (m metrics) String() string {
	n := len(hybridFixture.queries)
	return fmt.Sprintf("hit@1 %d/%d, hit@3 %d/%d, MRR %.2f", m.hit1, n, m.hit3, n, m.mrr)
}

func TestHybridSearchBeatsVectorSearchOnTheFixture(t *testing.T) {
	h := newTeamHarness(t)
	names := h.uploadFixture(t)
	eval := func(hybrid bool) metrics {
		var m metrics
		for _, q := range hybridFixture.queries {
			got := h.fixtureRanking(t, names, q, hybrid)
			for i, name := range got {
				if name != q.want {
					continue
				}
				if i == 0 {
					m.hit1++
				}
				m.hit3++
				m.mrr += 1 / float64(i+1)
			}
			t.Logf("hybrid=%-5v %-45q -> %s", hybrid, q.text, strings.Join(got, ", "))
		}
		m.mrr /= float64(len(hybridFixture.queries))
		return m
	}
	before, after := eval(false), eval(true)
	t.Logf("before (vector only): %s", before)
	t.Logf("after  (hybrid):      %s", after)
	// Recorded in docs/architecture/hybrid-search.md.
	if before.hit1 != 3 || before.hit3 != 5 || after.hit1 != 6 || after.hit3 != 8 {
		t.Errorf("before = %s, after = %s; update the recorded evaluation if the change is intended", before, after)
	}
}

func TestExactTermsAreFoundEvenWhenSemanticallyDistant(t *testing.T) {
	h := newTeamHarness(t)
	names := h.uploadFixture(t)
	resp, err := h.server.SearchDocuments(asUser(t, bob, nil), &documentv1.SearchDocumentsRequest{Query: "ERR-4711"})
	if err != nil {
		t.Fatal(err)
	}
	// The fake llm embeds every query to topic 0 (the refund chunk).
	docs := resp.GetDocuments()
	var found *documentv1.ScoredDocument
	for _, d := range docs {
		if names[d.GetDocumentId()] == "vault" {
			found = d
		}
	}
	if found == nil {
		t.Fatalf("documents = %v, want the vault chunk", docs)
	}
	if !found.GetKeywordMatch() || !strings.Contains(found.GetExcerpt(), "ERR-4711") {
		t.Errorf("vault = %v, want a keyword match whose excerpt shows the term", found)
	}
	for _, r := range resp.GetResults() {
		if names[r.GetChunk().GetDocumentId()] == "vault" && (!r.GetKeywordMatch() || !strings.Contains(r.GetExcerpt(), "ERR-4711")) {
			t.Errorf("result = %v, want the excerpt with the term", r)
		}
	}
}

func TestWordMatchesOnlyShowDocumentsTheCallerCanRead(t *testing.T) {
	h := newTeamHarness(t)
	public := h.uploadChunk(t, "The secret code word is ZEBRA-17 in the public handbook.", oneHot(5))
	inA := h.uploadChunk(t, "The secret code word is ZEBRA-17 in team A's notes.", oneHot(5), teamA)
	inB := h.uploadChunk(t, "The secret code word is ZEBRA-17 in team B's notes.", oneHot(5), teamB)
	for name, tc := range map[string]struct {
		user  string
		teams []uuid.UUID
		want  []string
	}{
		"member of A":       {bob, []uuid.UUID{teamA}, []string{public, inA}},
		"member of B":       {bob, []uuid.UUID{teamB}, []string{public, inB}},
		"no team":           {carol, nil, []string{public}},
		"owner without iam": {alice, nil, []string{public, inA, inB}},
	} {
		ctx := asUser(t, tc.user, tc.teams)
		chunks, err := h.server.SearchChunks(ctx, &documentv1.SearchChunksRequest{Embedding: oneHot(0), EmbeddingModel: "test-model", Query: "ZEBRA-17", Limit: 10})
		if err != nil {
			t.Fatal(err)
		}
		docs, err := h.server.SearchDocuments(ctx, &documentv1.SearchDocumentsRequest{Query: "ZEBRA-17", Limit: 10})
		if err != nil {
			t.Fatal(err)
		}
		var byChunk, byDocument []string
		for _, r := range chunks.GetResults() {
			byChunk = append(byChunk, r.GetChunk().GetDocumentId())
		}
		for _, d := range docs.GetDocuments() {
			byDocument = append(byDocument, d.GetDocumentId())
		}
		for path, got := range map[string][]string{"SearchChunks": byChunk, "SearchDocuments": byDocument} {
			if !sameSet(got, tc.want) {
				t.Errorf("%s, %s: found %v, want %v", name, path, got, tc.want)
			}
		}
	}
}

func sameSet(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	seen := map[string]bool{}
	for _, s := range a {
		seen[s] = true
	}
	for _, s := range b {
		if !seen[s] {
			return false
		}
	}
	return true
}
