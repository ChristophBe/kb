package server

import (
	"context"
	"fmt"
	"slices"

	"github.com/google/uuid"
	"google.golang.org/grpc/codes"

	documentv1 "github.com/ChristophBe/knowcelium/modules/document/api/go/documentv1"
	"github.com/ChristophBe/knowcelium/modules/document/service/internal/store"
	"github.com/ChristophBe/knowcelium/platform/go/grpcserver"
)

// access is who a user-facing call is made for: the user, and the teams they
// belong to, whose shared documents they may read. Without a resolver, or
// while iam is down, they belong to none and see only their own documents.
type access struct {
	user string
	p    grpcserver.Principal
}

// accessOf returns the access of the call's user.
func accessOf(ctx context.Context) (access, error) {
	user, err := caller(ctx)
	if err != nil {
		return access{}, err
	}
	p, _ := grpcserver.PrincipalFromContext(ctx)
	return access{user: user, p: p}, nil
}

// teamIDs returns the ids of the caller's teams, never nil: the queries
// compare a document's teams with them.
func (a access) teamIDs() []uuid.UUID {
	ids := make([]uuid.UUID, 0, len(a.p.Teams))
	for _, t := range a.p.Teams {
		if id, err := uuid.Parse(t.ID); err == nil {
			ids = append(ids, id)
		}
	}
	return ids
}

func (a access) inTeam(id uuid.UUID) bool { return slices.Contains(a.teamIDs(), id) }

func (a access) isTeamAdmin(id uuid.UUID) bool { return a.p.IsTeamAdmin(id.String()) }

// parseTeamIDs parses the team ids of a request field, without duplicates.
func parseTeamIDs(field string, raw []string) ([]uuid.UUID, error) {
	ids := make([]uuid.UUID, 0, len(raw))
	for i, r := range raw {
		id, err := uuid.Parse(r)
		if err != nil {
			return nil, grpcserver.InvalidArgument(grpcserver.Violation(fmt.Sprintf("%s[%d]", field, i), fmt.Sprintf("Invalid id %q", r)))
		}
		if !slices.Contains(ids, id) {
			ids = append(ids, id)
		}
	}
	return ids, nil
}

// shareable parses team ids a document is to be shared with: the caller must
// belong to each, and a team they don't belong to is not found.
func (a access) shareable(raw []string) ([]uuid.UUID, error) {
	ids, err := parseTeamIDs("team_ids", raw)
	if err != nil {
		return nil, err
	}
	for _, id := range ids {
		if !a.inTeam(id) {
			return nil, errTeamNotFound()
		}
	}
	return ids, nil
}

func errTeamNotFound() error {
	return grpcserver.WithDetails(codes.NotFound, "team not found", grpcserver.ErrorInfo(domain, "TEAM_NOT_FOUND", nil))
}

func errSharingNotAllowed(msg string) error {
	return grpcserver.WithDetails(codes.PermissionDenied, msg, grpcserver.ErrorInfo(domain, "SHARING_NOT_ALLOWED", nil))
}

// protos converts documents for the caller, adding the teams each is shared
// with: all of them for its owner, those the caller belongs to for anyone else.
func (s *Server) protos(ctx context.Context, a access, docs ...store.DocumentDocument) ([]*documentv1.Document, error) {
	ids := make([]uuid.UUID, len(docs))
	for i, d := range docs {
		ids[i] = d.ID
	}
	rows, err := s.repo.ListDocumentTeams(ctx, ids)
	if err != nil {
		return nil, s.internal("list document teams", err)
	}
	owners := make(map[uuid.UUID]string, len(docs))
	for _, d := range docs {
		owners[d.ID] = d.OwnerID
	}
	teams := make(map[uuid.UUID][]string, len(docs))
	for _, r := range rows {
		if owners[r.DocumentID] == a.user || a.inTeam(r.TeamID) {
			teams[r.DocumentID] = append(teams[r.DocumentID], r.TeamID.String())
		}
	}
	out := make([]*documentv1.Document, len(docs))
	for i, d := range docs {
		out[i] = toProto(d)
		out[i].TeamIds = teams[d.ID]
		slices.Sort(out[i].TeamIds)
	}
	return out, nil
}

// SetDocumentTeams sets the teams a document is shared with, as far as the
// caller may: the owner shares it with teams they belong to and stops
// sharing it with any; an admin of a team it is shared with can only stop
// sharing it with their own team. The set covers the teams the caller sees.
func (s *Server) SetDocumentTeams(ctx context.Context, req *documentv1.SetDocumentTeamsRequest) (*documentv1.SetDocumentTeamsResponse, error) {
	a, err := accessOf(ctx)
	if err != nil {
		return nil, err
	}
	id, err := parseID("id", req.GetId())
	if err != nil {
		return nil, err
	}
	want, err := parseTeamIDs("team_ids", req.GetTeamIds())
	if err != nil {
		return nil, err
	}
	doc, err := s.getVisible(ctx, a, id)
	if err != nil {
		return nil, err
	}
	rows, err := s.repo.ListDocumentTeams(ctx, []uuid.UUID{id})
	if err != nil {
		return nil, s.internal("list document teams", err)
	}
	isOwner := doc.OwnerID == a.user
	var current []uuid.UUID
	for _, r := range rows {
		if isOwner || a.inTeam(r.TeamID) {
			current = append(current, r.TeamID)
		}
	}
	var add, remove []uuid.UUID
	for _, t := range want {
		if !slices.Contains(current, t) {
			add = append(add, t)
		}
	}
	for _, t := range current {
		if !slices.Contains(want, t) {
			remove = append(remove, t)
		}
	}
	if isOwner {
		for _, t := range add {
			if !a.inTeam(t) {
				return nil, errTeamNotFound()
			}
		}
	} else {
		if len(add) > 0 {
			return nil, errSharingNotAllowed("only the owner can share a document with more teams")
		}
		for _, t := range remove {
			if !a.isTeamAdmin(t) {
				return nil, errSharingNotAllowed("only a team admin can stop sharing a document with their team")
			}
		}
	}
	if err := s.repo.ApplyDocumentTeams(ctx, id, add, remove); err != nil {
		return nil, s.internal("set document teams", err)
	}
	docs, err := s.protos(ctx, a, doc)
	if err != nil {
		return nil, err
	}
	return &documentv1.SetDocumentTeamsResponse{Document: docs[0]}, nil
}
