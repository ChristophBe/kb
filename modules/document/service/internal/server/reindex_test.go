package server

import (
	"context"
	"errors"
	"log/slog"
	"slices"
	"testing"

	"github.com/google/uuid"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	documentv1 "github.com/christoph/kb/modules/document/api/go/documentv1"
	"github.com/christoph/kb/modules/document/service/internal/store"
	"github.com/christoph/kb/platform/go/grpcserver"
)

// fakeReindexRepo adds the reindex query to fakeRepo.
type fakeReindexRepo struct {
	*fakeRepo
	targets []uuid.UUID
	asked   []store.ListReindexTargetsParams
}

func (f *fakeReindexRepo) ListReindexTargets(_ context.Context, p store.ListReindexTargetsParams) ([]uuid.UUID, error) {
	f.asked = append(f.asked, p)
	return f.targets, nil
}

type fakePublisher struct {
	sent   []*documentv1.DocumentReindexRequested
	failAt int // 1-based; 0 never fails
}

func (f *fakePublisher) PublishReindexRequested(_ context.Context, ev *documentv1.DocumentReindexRequested) error {
	if f.failAt > 0 && len(f.sent)+1 == f.failAt {
		return errors.New("nats down")
	}
	f.sent = append(f.sent, ev)
	return nil
}

func reindexServer(repo Repository, llm *fakeLLM, pub *fakePublisher) *Server {
	return newServerWith(repo, llm).WithReindexPublisher(pub)
}

func newServerWith(repo Repository, llm *fakeLLM) *Server {
	return New(repo, fakeObjects{}, llm, testLimits, slog.New(slog.DiscardHandler))
}

func TestReindexPublishesOneEventPerOutdatedDocument(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	repo := &fakeReindexRepo{fakeRepo: &fakeRepo{}, targets: []uuid.UUID{a, b}}
	pub := &fakePublisher{}
	resp, err := reindexServer(repo, &fakeLLM{model: "new-model"}, pub).ReindexDocuments(asAlice(t), &documentv1.ReindexDocumentsRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if resp.GetRequested() != 2 || resp.GetEmbeddingModel() != "new-model" {
		t.Errorf("response = %v", resp)
	}
	if len(pub.sent) != 2 || pub.sent[0].GetDocumentId() != a.String() || pub.sent[1].GetDocumentId() != b.String() {
		t.Fatalf("events = %v", pub.sent)
	}
	for _, ev := range pub.sent {
		if ev.GetOwnerId() != alice || ev.GetEmbeddingModel() != "new-model" {
			t.Errorf("event = %v, want alice's, for new-model", ev)
		}
	}
	// The query is for the caller's documents and the model llm uses now.
	if q := repo.asked[0]; q.OwnerID != alice || q.EmbeddingModel != "new-model" || q.Force {
		t.Errorf("query = %+v", q)
	}
}

func TestReindexForcePassesOnAndLimitsToTheGivenDocuments(t *testing.T) {
	id := uuid.New()
	repo := &fakeReindexRepo{fakeRepo: &fakeRepo{doc: store.DocumentDocument{ID: id, OwnerID: alice}}, targets: []uuid.UUID{id}}
	_, err := reindexServer(repo, &fakeLLM{}, &fakePublisher{}).ReindexDocuments(asAlice(t),
		&documentv1.ReindexDocumentsRequest{DocumentIds: []string{id.String()}, Force: true})
	if err != nil {
		t.Fatal(err)
	}
	if q := repo.asked[0]; !q.Force || !slices.Equal(q.DocumentIds, []uuid.UUID{id}) {
		t.Errorf("query = %+v", q)
	}
}

func TestReindexRejectsWhatIsNotTheCallers(t *testing.T) {
	pub := &fakePublisher{}
	repo := &fakeReindexRepo{fakeRepo: &fakeRepo{}}
	srv := reindexServer(repo, &fakeLLM{}, pub)
	if _, err := srv.ReindexDocuments(t.Context(), &documentv1.ReindexDocumentsRequest{}); status.Code(err) != codes.Unauthenticated {
		t.Errorf("no user: err = %v", err)
	}
	// Bob asks for alice's document.
	repo.doc = store.DocumentDocument{ID: uuid.New(), OwnerID: alice}
	_, err := srv.ReindexDocuments(grpcserver.WithUser(t.Context(), bob),
		&documentv1.ReindexDocumentsRequest{DocumentIds: []string{repo.doc.ID.String()}})
	if status.Code(err) != codes.NotFound {
		t.Errorf("another user's document: err = %v", err)
	}
	if _, err := srv.ReindexDocuments(asAlice(t), &documentv1.ReindexDocumentsRequest{DocumentIds: []string{"nope"}}); status.Code(err) != codes.InvalidArgument {
		t.Errorf("bad id: err = %v", err)
	}
	if len(pub.sent) != 0 || len(repo.asked) != 0 {
		t.Errorf("events %v, queries %v", pub.sent, repo.asked)
	}
}

func TestReindexFailsWithUnavailableWhenAPeerIsDown(t *testing.T) {
	repo := &fakeReindexRepo{fakeRepo: &fakeRepo{}, targets: []uuid.UUID{uuid.New(), uuid.New()}}
	// llm down: the current model is unknown.
	pub := &fakePublisher{}
	_, err := reindexServer(repo, &fakeLLM{err: status.Error(codes.Unavailable, "down")}, pub).ReindexDocuments(asAlice(t), &documentv1.ReindexDocumentsRequest{})
	if status.Code(err) != codes.Unavailable || len(pub.sent) != 0 {
		t.Errorf("llm down: err = %v, events %v", err, pub.sent)
	}
	// The event stream fails after the first document.
	pub = &fakePublisher{failAt: 2}
	_, err = reindexServer(repo, &fakeLLM{}, pub).ReindexDocuments(asAlice(t), &documentv1.ReindexDocumentsRequest{})
	if status.Code(err) != codes.Unavailable {
		t.Errorf("nats down: err = %v", err)
	}
	// No publisher at all.
	_, err = newServerWith(repo, &fakeLLM{}).ReindexDocuments(asAlice(t), &documentv1.ReindexDocumentsRequest{})
	if status.Code(err) != codes.Unavailable {
		t.Errorf("no publisher: err = %v", err)
	}
}

func TestSearchesCompareOnlyVectorsOfTheQuerysModel(t *testing.T) {
	repo := &fakeRepo{}
	llm := &fakeLLM{vector: []float32{1, 0}, model: "model-b"}
	srv := newServerWith(repo, llm)
	if _, err := srv.SearchDocuments(asAlice(t), &documentv1.SearchDocumentsRequest{Query: "q"}); err != nil {
		t.Fatal(err)
	}
	if repo.searches[0].EmbeddingModel != "model-b" || repo.bestReq[0].EmbeddingModel != "model-b" {
		t.Errorf("searched models %q, %q, want the model that embedded the query",
			repo.searches[0].EmbeddingModel, repo.bestReq[0].EmbeddingModel)
	}
	// SearchChunks takes the caller's model...
	if _, err := srv.SearchChunks(asAlice(t), &documentv1.SearchChunksRequest{Embedding: []float32{1, 0}, EmbeddingModel: "model-a"}); err != nil {
		t.Fatal(err)
	}
	if repo.searches[1].EmbeddingModel != "model-a" {
		t.Errorf("searched model %q, want model-a", repo.searches[1].EmbeddingModel)
	}
	// ... or asks llm for its current one (an Embed without inputs).
	llm.calls = nil
	if _, err := srv.SearchChunks(asAlice(t), &documentv1.SearchChunksRequest{Embedding: []float32{1, 0}}); err != nil {
		t.Fatal(err)
	}
	if repo.searches[2].EmbeddingModel != "model-b" || len(llm.calls) != 1 || len(llm.calls[0].GetInputs()) != 0 {
		t.Errorf("searched model %q after calls %v", repo.searches[2].EmbeddingModel, llm.calls)
	}
}

func TestAddChunksNeedsOneEmbeddingModelForAllChunks(t *testing.T) {
	chunk := func(i int32, model string) *documentv1.ChunkInput {
		return &documentv1.ChunkInput{Index: i, Text: "t", Embedding: []float32{1}, EmbeddingModel: model}
	}
	for name, chunks := range map[string][]*documentv1.ChunkInput{
		"no model":     {chunk(0, "")},
		"mixed models": {chunk(0, "a"), chunk(1, "b")},
	} {
		repo := &fakeRepo{}
		_, err := newServerWith(repo, &fakeLLM{}).AddChunks(t.Context(),
			&documentv1.AddChunksRequest{DocumentId: uuid.NewString(), Chunks: chunks})
		if status.Code(err) != codes.InvalidArgument {
			t.Errorf("%s: err = %v", name, err)
		}
	}
}
