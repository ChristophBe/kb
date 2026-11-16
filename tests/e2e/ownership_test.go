//go:build e2e

package e2e

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect"

	documentv1 "github.com/ChristophBe/knowcelium/modules/document/api/go/documentv1"
)

// otherUser is a second static user of the dev Dex.
const otherUser = "bob@example.com"

// TestPublicDocumentsAreReadOnlyForOthers uploads a public document (the
// default) as the test user and checks that another user can list and read it
// but neither change nor delete it.
func TestPublicDocumentsAreReadOnlyForOthers(t *testing.T) {
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
		return slices.ContainsFunc(resp.Msg.GetDocuments(), func(d *documentv1.Document) bool {
			return d.GetId() == id && d.GetAccess() == documentv1.Access_ACCESS_PUBLIC
		})
	}
	if !listed(alice) {
		t.Errorf("the uploader does not see document %s", id)
	}
	if !listed(bob) {
		t.Errorf("%s does not see the public document %s of %s", otherUser, id, testUser)
	}

	h, opt := bearer(bobToken), connect.WithGRPCWeb()
	get := connect.NewClient[documentv1.GetDocumentRequest, documentv1.GetDocumentResponse](h, kb.gateway+documentv1.DocumentService_GetDocument_FullMethodName, opt)
	if _, err := get.CallUnary(ctx, connect.NewRequest(&documentv1.GetDocumentRequest{Id: id})); err != nil {
		t.Errorf("GetDocument as %s: %v", otherUser, err)
	}
	del := connect.NewClient[documentv1.DeleteDocumentRequest, documentv1.DeleteDocumentResponse](h, kb.gateway+documentv1.DocumentService_DeleteDocument_FullMethodName, opt)
	if _, err := del.CallUnary(ctx, connect.NewRequest(&documentv1.DeleteDocumentRequest{Id: id})); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("DeleteDocument as %s: err = %v, want %s", otherUser, err, connect.CodePermissionDenied)
	}
	if !listed(alice) {
		t.Errorf("document %s is gone after %s tried to delete it", id, otherUser)
	}
}
