package server

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	documentv1 "github.com/ChristophBe/knowcelium/modules/document/api/go/documentv1"
	"github.com/ChristophBe/knowcelium/modules/document/service/internal/store"
	"github.com/ChristophBe/knowcelium/platform/go/grpcserver"
)

var (
	teamA = uuid.MustParse("00000000-0000-0000-0000-00000000000a")
	teamB = uuid.MustParse("00000000-0000-0000-0000-00000000000b")
)

// asUser is the context of a call user made while belonging to the teams;
// admin lists those they administer.
func asUser(t *testing.T, user string, teams []uuid.UUID, admin ...uuid.UUID) context.Context {
	t.Helper()
	p := grpcserver.Principal{UserID: user}
	for _, id := range teams {
		p.Teams = append(p.Teams, grpcserver.Team{ID: id.String()})
	}
	for _, id := range admin {
		for i := range p.Teams {
			if p.Teams[i].ID == id.String() {
				p.Teams[i].Admin = true
			}
		}
	}
	return grpcserver.WithPrincipal(t.Context(), p)
}

// sharedRepo has alice's team document, shared with team A.
func sharedRepo() (*fakeRepo, store.DocumentDocument) {
	doc := store.DocumentDocument{ID: uuid.New(), OwnerID: alice, ObjectKey: "k", Access: int16(documentv1.Access_ACCESS_TEAM)}
	return &fakeRepo{doc: doc, list: []store.DocumentDocument{doc}, shared: map[uuid.UUID][]uuid.UUID{doc.ID: {teamA}}}, doc
}

func TestTeamMembersReadASharedDocument(t *testing.T) {
	repo, doc := sharedRepo()
	s := newServer(repo)
	member := asUser(t, bob, []uuid.UUID{teamA})
	got, err := s.GetDocument(member, &documentv1.GetDocumentRequest{Id: doc.ID.String()})
	if err != nil {
		t.Fatal(err)
	}
	if ids := got.GetDocument().GetTeamIds(); len(ids) != 1 || ids[0] != teamA.String() {
		t.Errorf("team_ids = %v, want [%s]", ids, teamA)
	}
	list, err := s.ListDocuments(member, &documentv1.ListDocumentsRequest{})
	if err != nil || len(list.GetDocuments()) != 1 {
		t.Errorf("list = %v, %v; want the shared document", list.GetDocuments(), err)
	}
	if _, err := s.GetDownloadUrl(member, &documentv1.GetDownloadUrlRequest{Id: doc.ID.String()}); err != nil {
		t.Errorf("download: %v", err)
	}
	if _, err := s.SearchChunks(member, &documentv1.SearchChunksRequest{Embedding: []float32{1}}); err != nil {
		t.Fatal(err)
	}
	if got := repo.searches[0]; got.OwnerID != bob || len(got.TeamIds) != 1 || got.TeamIds[0] != teamA {
		t.Errorf("search params = %+v, want bob with team A", got)
	}
}

func TestOthersDoNotReadASharedDocument(t *testing.T) {
	repo, doc := sharedRepo()
	s := newServer(repo)
	for name, ctx := range map[string]context.Context{
		"member of another team": asUser(t, bob, []uuid.UUID{teamB}),
		"without teams":          asUser(t, bob, nil),
		"without a resolver":     grpcserver.WithUser(t.Context(), bob),
		"platform admin":         grpcserver.WithPrincipal(t.Context(), grpcserver.Principal{UserID: bob, PlatformAdmin: true}),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := s.GetDocument(ctx, &documentv1.GetDocumentRequest{Id: doc.ID.String()}); status.Code(err) != codes.NotFound {
				t.Errorf("get: %v, want NotFound", err)
			}
			if list, err := s.ListDocuments(ctx, &documentv1.ListDocumentsRequest{}); err != nil || len(list.GetDocuments()) != 0 {
				t.Errorf("list = %v, %v; want nothing", list.GetDocuments(), err)
			}
		})
	}
}

func TestMembersOnlySeeTheirOwnTeamsOfADocument(t *testing.T) {
	repo, doc := sharedRepo()
	repo.shared[doc.ID] = []uuid.UUID{teamA, teamB}
	s := newServer(repo)
	member, err := s.GetDocument(asUser(t, bob, []uuid.UUID{teamB}), &documentv1.GetDocumentRequest{Id: doc.ID.String()})
	if err != nil {
		t.Fatal(err)
	}
	if ids := member.GetDocument().GetTeamIds(); len(ids) != 1 || ids[0] != teamB.String() {
		t.Errorf("a member's team_ids = %v, want only [%s]", ids, teamB)
	}
	owner, err := s.GetDocument(asAlice(t), &documentv1.GetDocumentRequest{Id: doc.ID.String()})
	if err != nil {
		t.Fatal(err)
	}
	if ids := owner.GetDocument().GetTeamIds(); len(ids) != 2 {
		t.Errorf("the owner's team_ids = %v, want both teams", ids)
	}
}

func TestOnlyTheOwnerChangesOrDeletesADocument(t *testing.T) {
	repo, doc := sharedRepo()
	s := newServer(repo)
	member := asUser(t, bob, []uuid.UUID{teamA}, teamA)
	id := doc.ID.String()
	if _, err := s.DeleteDocument(member, &documentv1.DeleteDocumentRequest{Id: id}); status.Code(err) != codes.PermissionDenied {
		t.Errorf("delete: %v, want PermissionDenied (even for a team admin)", err)
	}
	if _, err := s.ReplaceContent(member, &documentv1.ReplaceContentRequest{Id: id, Filename: "a.md", SizeBytes: 1}); status.Code(err) != codes.PermissionDenied {
		t.Errorf("replace: %v, want PermissionDenied", err)
	}
	if _, err := s.ReindexDocuments(member, &documentv1.ReindexDocumentsRequest{DocumentIds: []string{id}}); status.Code(err) != codes.PermissionDenied {
		t.Errorf("reindex: %v, want PermissionDenied", err)
	}
	if len(repo.deleted) != 0 {
		t.Errorf("deleted %v", repo.deleted)
	}
}

func TestCreateDocumentSharesWithTheCallersTeams(t *testing.T) {
	repo := &fakeRepo{}
	s := newServer(repo)
	resp, err := s.CreateDocument(asUser(t, alice, []uuid.UUID{teamA, teamB}), &documentv1.CreateDocumentRequest{
		Filename: "a.md", SizeBytes: 1, Access: documentv1.Access_ACCESS_TEAM, TeamIds: []string{teamB.String(), teamA.String(), teamA.String()},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := repo.created[0].Access; got != int16(documentv1.Access_ACCESS_TEAM) {
		t.Errorf("created with access %d, want TEAM", got)
	}
	if len(repo.applied) != 1 || len(repo.applied[0].add) != 2 || len(repo.applied[0].remove) != 0 {
		t.Errorf("applied = %+v, want both teams added once", repo.applied)
	}
	if repo.applied[0].id.String() != resp.GetDocument().GetId() {
		t.Errorf("shared document %s, created %s", repo.applied[0].id, resp.GetDocument().GetId())
	}
}

func TestCreateDocumentRejectsTeamsTheCallerDoesNotBelongTo(t *testing.T) {
	repo := &fakeRepo{}
	s := newServer(repo)
	for name, tc := range map[string]struct {
		ctx  context.Context
		want codes.Code
	}{
		"another team":    {asUser(t, alice, []uuid.UUID{teamB}), codes.NotFound},
		"no team":         {asAlice(t), codes.NotFound},
		"iam unavailable": {grpcserver.WithPrincipal(t.Context(), grpcserver.Principal{UserID: alice, Unavailable: true}), codes.Unavailable},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := s.CreateDocument(tc.ctx, &documentv1.CreateDocumentRequest{
				Filename: "a.md", SizeBytes: 1, Access: documentv1.Access_ACCESS_TEAM, TeamIds: []string{teamA.String()},
			})
			if status.Code(err) != tc.want {
				t.Errorf("err = %v, want %v", err, tc.want)
			}
			if len(repo.created) != 0 {
				t.Errorf("a document was created: %+v", repo.created)
			}
		})
	}
	_, err := s.CreateDocument(asAlice(t), &documentv1.CreateDocumentRequest{
		Filename: "a.md", SizeBytes: 1, Access: documentv1.Access_ACCESS_TEAM, TeamIds: []string{"x"},
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Errorf("invalid id: %v, want InvalidArgument", err)
	}
}

func TestCreateDocumentValidatesAccess(t *testing.T) {
	repo := &fakeRepo{}
	s := newServer(repo)
	member := asUser(t, alice, []uuid.UUID{teamA})
	for name, req := range map[string]*documentv1.CreateDocumentRequest{
		"a team document without teams": {Access: documentv1.Access_ACCESS_TEAM},
		"a public document with teams":  {Access: documentv1.Access_ACCESS_PUBLIC, TeamIds: []string{teamA.String()}},
		"an unset access with teams":    {TeamIds: []string{teamA.String()}},
		"an unknown access":             {Access: 9},
	} {
		t.Run(name, func(t *testing.T) {
			req.Filename, req.SizeBytes = "a.md", 1
			if _, err := s.CreateDocument(member, req); status.Code(err) != codes.InvalidArgument {
				t.Errorf("err = %v, want InvalidArgument", err)
			}
		})
	}
	if len(repo.created) != 0 {
		t.Errorf("a document was created: %+v", repo.created)
	}
}

func TestCreateDocumentIsPublicUnlessSaidOtherwise(t *testing.T) {
	repo := &fakeRepo{}
	s := newServer(repo)
	for _, level := range []documentv1.Access{documentv1.Access_ACCESS_UNSPECIFIED, documentv1.Access_ACCESS_PUBLIC} {
		resp, err := s.CreateDocument(asAlice(t), &documentv1.CreateDocumentRequest{Filename: "a.md", SizeBytes: 1, Access: level})
		if err != nil {
			t.Fatal(err)
		}
		if got := resp.GetDocument().GetAccess(); got != documentv1.Access_ACCESS_PUBLIC {
			t.Errorf("access %v gave %v, want PUBLIC", level, got)
		}
	}
	if len(repo.applied) != 0 {
		t.Errorf("applied teams %+v to a public document", repo.applied)
	}
}

func TestEveryoneReadsAPublicDocument(t *testing.T) {
	doc := store.DocumentDocument{ID: uuid.New(), OwnerID: alice, ObjectKey: "k", Access: int16(documentv1.Access_ACCESS_PUBLIC)}
	s := newServer(&fakeRepo{doc: doc, list: []store.DocumentDocument{doc}})
	for name, ctx := range map[string]context.Context{
		"user without teams": asUser(t, bob, nil),
		"without a resolver": grpcserver.WithUser(t.Context(), bob),
		"iam unavailable":    grpcserver.WithPrincipal(t.Context(), grpcserver.Principal{UserID: bob, Unavailable: true}),
	} {
		t.Run(name, func(t *testing.T) {
			got, err := s.GetDocument(ctx, &documentv1.GetDocumentRequest{Id: doc.ID.String()})
			if err != nil || got.GetDocument().GetAccess() != documentv1.Access_ACCESS_PUBLIC {
				t.Errorf("get = %v, %v; want the public document", got, err)
			}
			if list, err := s.ListDocuments(ctx, &documentv1.ListDocumentsRequest{}); err != nil || len(list.GetDocuments()) != 1 {
				t.Errorf("list = %v, %v; want the public document", list.GetDocuments(), err)
			}
		})
	}
	// Only the owner changes it.
	if _, err := s.DeleteDocument(asUser(t, bob, nil), &documentv1.DeleteDocumentRequest{Id: doc.ID.String()}); status.Code(err) != codes.PermissionDenied {
		t.Errorf("delete by another user: %v, want PermissionDenied", err)
	}
	// It has no teams to set.
	if _, err := s.SetDocumentTeams(asUser(t, alice, []uuid.UUID{teamA}), &documentv1.SetDocumentTeamsRequest{Id: doc.ID.String(), TeamIds: []string{teamA.String()}}); status.Code(err) != codes.FailedPrecondition {
		t.Errorf("set teams of a public document: %v, want FailedPrecondition", err)
	}
}

func TestOwnerSetsTheTeamsOfADocument(t *testing.T) {
	repo, doc := sharedRepo()
	s := newServer(repo)
	// Alice belongs to B but no longer to A: she can move the document to B.
	resp, err := s.SetDocumentTeams(asUser(t, alice, []uuid.UUID{teamB}), &documentv1.SetDocumentTeamsRequest{Id: doc.ID.String(), TeamIds: []string{teamB.String()}})
	if err != nil {
		t.Fatal(err)
	}
	got := repo.applied[0]
	if len(got.add) != 1 || got.add[0] != teamB || len(got.remove) != 1 || got.remove[0] != teamA {
		t.Errorf("applied add %v remove %v, want +B -A", got.add, got.remove)
	}
	if resp.GetDocument().GetId() != doc.ID.String() {
		t.Errorf("document = %v", resp.GetDocument())
	}
	// Sharing with a team she is not in fails.
	_, err = s.SetDocumentTeams(asUser(t, alice, nil), &documentv1.SetDocumentTeamsRequest{Id: doc.ID.String(), TeamIds: []string{teamA.String(), teamB.String()}})
	if status.Code(err) != codes.NotFound {
		t.Errorf("sharing with a foreign team: %v, want NotFound", err)
	}
	// Stopping to share needs no membership.
	if _, err := s.SetDocumentTeams(asAlice(t), &documentv1.SetDocumentTeamsRequest{Id: doc.ID.String()}); err != nil {
		t.Fatal(err)
	}
	if last := repo.applied[len(repo.applied)-1]; len(last.remove) != 1 || last.remove[0] != teamA {
		t.Errorf("applied %+v, want A removed", last)
	}
}

func TestATeamAdminOnlyRemovesTheirTeam(t *testing.T) {
	repo, doc := sharedRepo()
	repo.shared[doc.ID] = []uuid.UUID{teamA, teamB}
	s := newServer(repo)
	id := doc.ID.String()
	admin := asUser(t, bob, []uuid.UUID{teamA}, teamA)
	if _, err := s.SetDocumentTeams(admin, &documentv1.SetDocumentTeamsRequest{Id: id}); err != nil {
		t.Fatal(err)
	}
	if got := repo.applied[0]; len(got.add) != 0 || len(got.remove) != 1 || got.remove[0] != teamA {
		t.Errorf("applied %+v, want only A removed (B is not theirs to see)", got)
	}
	denied := map[string]struct {
		ctx   context.Context
		teams []string
	}{
		"a plain member removing their team": {asUser(t, bob, []uuid.UUID{teamA}), nil},
		"an admin adding a team":             {asUser(t, bob, []uuid.UUID{teamA, teamB}, teamA), []string{teamA.String(), teamB.String(), uuid.NewString()}},
	}
	for name, tc := range denied {
		t.Run(name, func(t *testing.T) {
			before := len(repo.applied)
			_, err := s.SetDocumentTeams(tc.ctx, &documentv1.SetDocumentTeamsRequest{Id: id, TeamIds: tc.teams})
			if status.Code(err) != codes.PermissionDenied {
				t.Errorf("err = %v, want PermissionDenied", err)
			}
			if len(repo.applied) != before {
				t.Error("the teams were changed")
			}
		})
	}
	if _, err := s.SetDocumentTeams(asUser(t, bob, []uuid.UUID{teamB}), &documentv1.SetDocumentTeamsRequest{Id: uuid.NewString()}); status.Code(err) != codes.NotFound {
		t.Errorf("unknown document: %v, want NotFound", err)
	}
	if _, err := s.SetDocumentTeams(asUser(t, "carol", nil), &documentv1.SetDocumentTeamsRequest{Id: id}); status.Code(err) != codes.NotFound {
		t.Errorf("a stranger: %v, want NotFound", err)
	}
}

func TestSetDocumentTeamsValidates(t *testing.T) {
	s := newServer(&fakeRepo{})
	for name, req := range map[string]*documentv1.SetDocumentTeamsRequest{
		"id":      {Id: "x"},
		"team id": {Id: uuid.NewString(), TeamIds: []string{"x"}},
	} {
		if _, err := s.SetDocumentTeams(asAlice(t), req); status.Code(err) != codes.InvalidArgument {
			t.Errorf("%s: %v, want InvalidArgument", name, err)
		}
	}
	if _, err := s.SetDocumentTeams(t.Context(), &documentv1.SetDocumentTeamsRequest{Id: uuid.NewString()}); status.Code(err) != codes.Unauthenticated {
		t.Errorf("without a user: %v, want Unauthenticated", err)
	}
}
