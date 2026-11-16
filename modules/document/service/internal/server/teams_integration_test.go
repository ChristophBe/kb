//go:build integration

package server

import (
	"log/slog"
	"testing"

	"github.com/google/uuid"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	documentv1 "github.com/ChristophBe/knowcelium/modules/document/api/go/documentv1"
	"github.com/ChristophBe/knowcelium/modules/document/migrations"
	"github.com/ChristophBe/knowcelium/modules/document/service/internal/store"
	"github.com/ChristophBe/knowcelium/platform/go/postgres/pgtest"
)

// teamHarness serves documents from a real database; files are not involved.
type teamHarness struct {
	server *Server
	repo   *store.Repo
}

func newTeamHarness(t *testing.T) *teamHarness {
	t.Helper()
	repo := store.NewRepo(pgtest.Start(t, "document", migrations.FS, store.ConfigurePool))
	return &teamHarness{
		repo:   repo,
		server: New(repo, fakeObjects{}, &fakeLLM{vector: oneHot(0), model: "test-model"}, testLimits, slog.New(slog.DiscardHandler)),
	}
}

func oneHot(i int) []float32 {
	v := make([]float32, 768)
	v[i] = 1
	return v
}

// upload creates a ready document of alice's with one chunk: a team document
// of teams (alice belongs to them), or a public one without any.
func (h *teamHarness) upload(t *testing.T, teams ...uuid.UUID) string {
	t.Helper()
	level := documentv1.Access_ACCESS_TEAM
	if len(teams) == 0 {
		level = documentv1.Access_ACCESS_PUBLIC
	}
	resp, err := h.server.CreateDocument(asUser(t, alice, teams), &documentv1.CreateDocumentRequest{
		Filename: "notes.md", SizeBytes: 1, Access: level, TeamIds: ids(teams),
	})
	if err != nil {
		t.Fatal(err)
	}
	id := resp.GetDocument().GetId()
	_, err = h.server.AddChunks(t.Context(), &documentv1.AddChunksRequest{DocumentId: id, Chunks: []*documentv1.ChunkInput{
		{Index: 0, Text: "shared notes", Embedding: oneHot(0), EmbeddingModel: "test-model"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func ids(teams []uuid.UUID) []string {
	var out []string
	for _, id := range teams {
		out = append(out, id.String())
	}
	return out
}

// reads counts how many of the read RPCs find the document for the caller:
// get, list, chunks, download, SearchChunks and SearchDocuments.
func (h *teamHarness) reads(t *testing.T, user string, teams []uuid.UUID, id string) int {
	t.Helper()
	ctx := asUser(t, user, teams)
	found := 0
	if _, err := h.server.GetDocument(ctx, &documentv1.GetDocumentRequest{Id: id}); err == nil {
		found++
	}
	if list, err := h.server.ListDocuments(ctx, &documentv1.ListDocumentsRequest{}); err == nil {
		for _, d := range list.GetDocuments() {
			if d.GetId() == id {
				found++
			}
		}
	}
	if _, err := h.server.ListChunks(ctx, &documentv1.ListChunksRequest{DocumentId: id}); err == nil {
		found++
	}
	if _, err := h.server.GetDownloadUrl(ctx, &documentv1.GetDownloadUrlRequest{Id: id}); err == nil {
		found++
	}
	if resp, err := h.server.SearchChunks(ctx, &documentv1.SearchChunksRequest{Embedding: oneHot(0), EmbeddingModel: "test-model"}); err == nil {
		for _, r := range resp.GetResults() {
			if r.GetChunk().GetDocumentId() == id {
				found++
			}
		}
	}
	if resp, err := h.server.SearchDocuments(ctx, &documentv1.SearchDocumentsRequest{Query: "notes"}); err == nil {
		for _, r := range resp.GetResults() {
			if r.GetChunk().GetDocumentId() == id {
				found++
			}
		}
		for _, d := range resp.GetDocuments() {
			if d.GetDocumentId() == id {
				found++
			}
		}
	}
	return found
}

const allReads = 7 // get, list, chunks, download, SearchChunks, and both results of SearchDocuments

func TestSharedDocumentIsVisibleToTheTeamOnly(t *testing.T) {
	h := newTeamHarness(t)
	id := h.upload(t, teamA)
	for name, tc := range map[string]struct {
		user  string
		teams []uuid.UUID
		want  int
	}{
		"owner":                  {alice, []uuid.UUID{teamA}, allReads},
		"owner without iam":      {alice, nil, allReads},
		"member":                 {bob, []uuid.UUID{teamA}, allReads},
		"member of another team": {bob, []uuid.UUID{teamB}, 0},
		"user without teams":     {bob, nil, 0},
	} {
		if got := h.reads(t, tc.user, tc.teams, id); got != tc.want {
			t.Errorf("%s: found the document %d times, want %d", name, got, tc.want)
		}
	}
}

func TestPublicDocumentIsVisibleToEveryone(t *testing.T) {
	h := newTeamHarness(t)
	id := h.upload(t)
	for name, tc := range map[string]struct {
		user  string
		teams []uuid.UUID
	}{
		"owner":              {alice, nil},
		"user without teams": {bob, nil},
		"member of a team":   {carol, []uuid.UUID{teamB}},
	} {
		if got := h.reads(t, tc.user, tc.teams, id); got != allReads {
			t.Errorf("%s: found the document %d times, want %d", name, got, allReads)
		}
	}
}

func TestTeamsCanChangeAndTakeEffectImmediately(t *testing.T) {
	h := newTeamHarness(t)
	id := h.upload(t, teamA)
	set := func(teams ...uuid.UUID) {
		t.Helper()
		if _, err := h.server.SetDocumentTeams(asUser(t, alice, []uuid.UUID{teamA, teamB}), &documentv1.SetDocumentTeamsRequest{Id: id, TeamIds: ids(teams)}); err != nil {
			t.Fatal(err)
		}
	}
	inA, inB := []uuid.UUID{teamA}, []uuid.UUID{teamB}
	if h.reads(t, bob, inB, id) != 0 {
		t.Fatal("a member of B sees the document before it is shared with B")
	}
	set(teamA, teamB)
	if h.reads(t, bob, inB, id) != allReads || h.reads(t, bob, inA, id) != allReads {
		t.Error("members of A and B should see the document after sharing with both")
	}
	set(teamB)
	if h.reads(t, bob, inA, id) != 0 || h.reads(t, bob, inB, id) != allReads {
		t.Error("only members of B should see the document after A was removed")
	}
	set()
	if h.reads(t, bob, inB, id) != 0 || h.reads(t, alice, nil, id) != allReads {
		t.Error("only the owner should see the document after it was unshared")
	}
}

func TestATeamAdminRemovesTheirTeamButAMemberCannot(t *testing.T) {
	h := newTeamHarness(t)
	id := h.upload(t, teamA, teamB)
	_, err := h.server.SetDocumentTeams(asUser(t, bob, []uuid.UUID{teamA}), &documentv1.SetDocumentTeamsRequest{Id: id, TeamIds: ids([]uuid.UUID{teamA})})
	if status.Code(err) != codes.OK {
		t.Fatalf("a no-op by a member: %v", err)
	}
	_, err = h.server.SetDocumentTeams(asUser(t, bob, []uuid.UUID{teamA}), &documentv1.SetDocumentTeamsRequest{Id: id})
	if status.Code(err) != codes.PermissionDenied {
		t.Errorf("a member removing their team: %v, want PermissionDenied", err)
	}
	resp, err := h.server.SetDocumentTeams(asUser(t, bob, []uuid.UUID{teamA}, teamA), &documentv1.SetDocumentTeamsRequest{Id: id})
	if err != nil {
		t.Fatal(err)
	}
	if got := resp.GetDocument().GetTeamIds(); len(got) != 0 {
		t.Errorf("the admin still sees teams %v", got)
	}
	if h.reads(t, bob, []uuid.UUID{teamA}, id) != 0 {
		t.Error("team A still sees the document")
	}
	if h.reads(t, carol, []uuid.UUID{teamB}, id) != allReads {
		t.Error("team B should still see the document: the admin of A only removes A")
	}
	if got := ownerTeams(t, h, id); len(got) != 1 || got[0] != teamB.String() {
		t.Errorf("the owner sees teams %v, want only B", got)
	}
}

const carol = "carol-subject"

func ownerTeams(t *testing.T, h *teamHarness, id string) []string {
	t.Helper()
	resp, err := h.server.GetDocument(asAlice(t), &documentv1.GetDocumentRequest{Id: id})
	if err != nil {
		t.Fatal(err)
	}
	return resp.GetDocument().GetTeamIds()
}

func TestOnlyTheOwnerDeletesASharedDocument(t *testing.T) {
	h := newTeamHarness(t)
	id := h.upload(t, teamA)
	_, err := h.server.DeleteDocument(asUser(t, bob, []uuid.UUID{teamA}, teamA), &documentv1.DeleteDocumentRequest{Id: id})
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("delete by a team admin: %v, want PermissionDenied", err)
	}
	if h.reads(t, alice, nil, id) != allReads {
		t.Error("the document was touched")
	}
	if _, err := h.server.DeleteDocument(asAlice(t), &documentv1.DeleteDocumentRequest{Id: id}); err != nil {
		t.Fatal(err)
	}
	if rows, err := h.repo.ListDocumentTeams(t.Context(), []uuid.UUID{uuid.MustParse(id)}); err != nil || len(rows) != 0 {
		t.Errorf("sharing rows after delete = %v, %v; want none", rows, err)
	}
}

func TestThePipelineStaysUnfiltered(t *testing.T) {
	h := newTeamHarness(t)
	id := h.upload(t, teamA)
	// The ingestion worker calls without a user and reaches every document.
	if _, err := h.server.SetDocumentStatus(t.Context(), &documentv1.SetDocumentStatusRequest{Id: id, Status: documentv1.DocumentStatus_DOCUMENT_STATUS_PROCESSING}); err != nil {
		t.Errorf("set status: %v", err)
	}
	if err := h.server.ReadContent(&documentv1.ReadContentRequest{Id: id}, &readStream{ctx: t.Context()}); err != nil {
		t.Errorf("read content: %v", err)
	}
}
