//go:build e2e

package e2e

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect"

	chatv1 "github.com/christoph/kb/modules/chat/api/go/chatv1"
	documentv1 "github.com/christoph/kb/modules/document/api/go/documentv1"
)

// otherUser is a second static user of the dev Dex.
const otherUser = "bob@example.com"

// TestDocumentsAreOwnedByTheirUploader uploads a document as the test user and
// checks that another user can neither see, delete nor chat with it.
func TestDocumentsAreOwnedByTheirUploader(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), testTimeout)
	defer cancel()
	alice := newClients(kb.gateway, kb.token)
	waitReady(ctx, t, alice)
	bobToken, err := fetchToken(kb.issuer, otherUser)
	if err != nil {
		t.Fatalf("token for %s: %v", otherUser, err)
	}
	bob := newClients(kb.gateway, bobToken)

	const title = "Glacier ownership test"
	id := upload(ctx, t, alice, "glacier-owner.md", title, "# Glaciers\n\nGlaciers form where snow piles up faster than it melts.\n")

	listed := func(c *clients) bool {
		t.Helper()
		resp, err := c.listDocuments.CallUnary(ctx, connect.NewRequest(&documentv1.ListDocumentsRequest{}))
		if err != nil {
			t.Fatalf("ListDocuments: %v", err)
		}
		return slices.ContainsFunc(resp.Msg.GetDocuments(), func(d *documentv1.Document) bool { return d.GetId() == id })
	}
	if !listed(alice) {
		t.Errorf("the uploader does not see document %s", id)
	}
	if listed(bob) {
		t.Errorf("%s sees document %s of %s", otherUser, id, testUser)
	}

	h, opt := bearer(bobToken), connect.WithGRPCWeb()
	get := connect.NewClient[documentv1.GetDocumentRequest, documentv1.GetDocumentResponse](h, kb.gateway+documentv1.DocumentService_GetDocument_FullMethodName, opt)
	if _, err := get.CallUnary(ctx, connect.NewRequest(&documentv1.GetDocumentRequest{Id: id})); connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("GetDocument as %s: err = %v, want %s", otherUser, err, connect.CodeNotFound)
	}
	del := connect.NewClient[documentv1.DeleteDocumentRequest, documentv1.DeleteDocumentResponse](h, kb.gateway+documentv1.DocumentService_DeleteDocument_FullMethodName, opt)
	if _, err := del.CallUnary(ctx, connect.NewRequest(&documentv1.DeleteDocumentRequest{Id: id})); connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("DeleteDocument as %s: err = %v, want %s", otherUser, err, connect.CodeNotFound)
	}
	if !listed(alice) {
		t.Errorf("document %s is gone after %s tried to delete it", id, otherUser)
	}

	// Chat searches the asking user's documents only, even when the
	// conversation names someone else's.
	conv, err := bob.createConversation.CallUnary(ctx, connect.NewRequest(&chatv1.CreateConversationRequest{DocumentIds: []string{id}}))
	if err != nil {
		t.Fatalf("CreateConversation: %v", err)
	}
	sources, answer := ask(ctx, t, bob, conv.Msg.GetConversation().GetId(), "How do glaciers form?")
	for _, c := range append(sources, answer.GetCitations()...) {
		if c.GetDocumentId() == id {
			t.Errorf("%s's answer cites document %s of %s", otherUser, id, testUser)
		}
	}
}
