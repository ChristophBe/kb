//go:build e2e

package e2e

import (
	"context"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"

	chatv1 "github.com/ChristophBe/knowcelium/modules/chat/api/go/chatv1"
	documentv1 "github.com/ChristophBe/knowcelium/modules/document/api/go/documentv1"
	iamv1 "github.com/ChristophBe/knowcelium/modules/iam/api/go/iamv1"
	ingestionv1 "github.com/ChristophBe/knowcelium/modules/ingestion/api/go/ingestionv1"
)

// teamCacheTimeout bounds waiting for the document module to see a change of
// team membership: it caches what IAM says about a caller for a short while.
const teamCacheTimeout = 90 * time.Second

// TestTeamMembersSeeSharedDocuments uploads a team document and checks
// that a member lists it and gets passages of it in chat, and that a user
// outside the team does neither, before joining and after leaving.
func TestTeamMembersSeeSharedDocuments(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), testTimeout)
	defer cancel()
	alice := newClients(kb.gateway, kb.token)
	waitReady(ctx, t, alice)
	bobToken, err := fetchToken(kb.issuer, otherUser)
	if err != nil {
		t.Fatalf("token for %s: %v", otherUser, err)
	}
	bob := newClients(kb.gateway, bobToken)

	// Users register with IAM when the shell first calls GetCurrentUser; bob
	// has to be known before alice can add him by email.
	for _, c := range []*clients{alice, bob} {
		if _, err := iamCall[iamv1.GetCurrentUserRequest, iamv1.GetCurrentUserResponse](c, iamv1.IamService_GetCurrentUser_FullMethodName, ctx, &iamv1.GetCurrentUserRequest{}); err != nil {
			t.Fatalf("GetCurrentUser: %v", err)
		}
	}
	team, err := iamCall[iamv1.CreateTeamRequest, iamv1.CreateTeamResponse](alice, iamv1.IamService_CreateTeam_FullMethodName, ctx, &iamv1.CreateTeamRequest{Name: "Glacier research"})
	if err != nil {
		t.Fatalf("CreateTeam: %v", err)
	}
	teamID := team.Msg.GetTeam().GetId()

	// A team the caller is not in cannot be shared with.
	_, err = bob.createUpload.CallUnary(ctx, connect.NewRequest(&ingestionv1.CreateUploadRequest{
		Filename: "x.md", ContentType: "text/markdown", SizeBytes: 3, Access: ingestionv1.Access_ACCESS_TEAM, TeamIds: []string{teamID},
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("CreateUpload to a foreign team as %s: err = %v, want %s", otherUser, err, connect.CodeNotFound)
	}

	const title = "Moraine survey notes"
	id := uploadShared(ctx, t, alice, "moraine.md", title,
		"# Moraines\n\nA moraine is a ridge of rubble that a retreating glacier leaves behind.\n", []string{teamID})

	const question = "What is a moraine, the ridge of rubble a retreating glacier leaves behind?"
	listed := func(c *clients) bool {
		t.Helper()
		resp, err := c.listDocuments.CallUnary(ctx, connect.NewRequest(&documentv1.ListDocumentsRequest{}))
		if err != nil {
			t.Fatalf("ListDocuments: %v", err)
		}
		return slices.ContainsFunc(resp.Msg.GetDocuments(), func(d *documentv1.Document) bool { return d.GetId() == id })
	}
	cited := func(c *clients) bool {
		t.Helper()
		conv, err := c.createConversation.CallUnary(ctx, connect.NewRequest(&chatv1.CreateConversationRequest{}))
		if err != nil {
			t.Fatalf("CreateConversation: %v", err)
		}
		sources, answer := ask(ctx, t, c, conv.Msg.GetConversation().GetId(), question)
		return cites(sources, id, title) || cites(answer.GetCitations(), id, title)
	}
	eventually := func(what string, ok func() bool) {
		t.Helper()
		deadline := time.Now().Add(teamCacheTimeout)
		for !ok() {
			if time.Now().After(deadline) || ctx.Err() != nil {
				t.Fatalf("%s did not happen within %s", what, teamCacheTimeout)
			}
			time.Sleep(3 * time.Second)
		}
	}

	if !listed(alice) || !cited(alice) {
		t.Fatalf("the uploader does not see or cite document %s", id)
	}
	// Outside the team: nothing in the list, no passage in an answer.
	if listed(bob) {
		t.Errorf("%s lists document %s before joining the team", otherUser, id)
	}
	if cited(bob) {
		t.Errorf("%s's answer cites document %s before joining the team", otherUser, id)
	}

	if _, err := iamCall[iamv1.AddMemberRequest, iamv1.AddMemberResponse](alice, iamv1.IamService_AddMember_FullMethodName, ctx, &iamv1.AddMemberRequest{TeamId: teamID, Email: otherUser}); err != nil {
		t.Fatalf("AddMember: %v", err)
	}
	eventually("the member listing the shared document", func() bool { return listed(bob) })
	if !cited(bob) {
		t.Errorf("%s's answer does not cite the shared document %s", otherUser, id)
	}

	if _, err := iamCall[iamv1.RemoveMemberRequest, iamv1.RemoveMemberResponse](alice, iamv1.IamService_RemoveMember_FullMethodName, ctx, &iamv1.RemoveMemberRequest{TeamId: teamID, UserId: bobID(ctx, t, bob)}); err != nil {
		t.Fatalf("RemoveMember: %v", err)
	}
	eventually("the former member losing the shared document", func() bool { return !listed(bob) })
	if cited(bob) {
		t.Errorf("%s's answer cites document %s after leaving the team", otherUser, id)
	}
}

// bobID returns the id IAM knows the user of c by.
func bobID(ctx context.Context, t *testing.T, c *clients) string {
	t.Helper()
	me, err := iamCall[iamv1.GetCurrentUserRequest, iamv1.GetCurrentUserResponse](c, iamv1.IamService_GetCurrentUser_FullMethodName, ctx, &iamv1.GetCurrentUserRequest{})
	if err != nil {
		t.Fatalf("GetCurrentUser: %v", err)
	}
	return me.Msg.GetUser().GetId()
}

// iamCall calls a unary method of the IAM module through the gateway as the
// user of c.
func iamCall[Req, Res any](c *clients, method string, ctx context.Context, req *Req) (*connect.Response[Res], error) {
	client := connect.NewClient[Req, Res](c.http, kb.gateway+method, connect.WithGRPCWeb())
	return client.CallUnary(ctx, connect.NewRequest(req))
}
