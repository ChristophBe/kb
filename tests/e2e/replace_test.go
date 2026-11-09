//go:build e2e

package e2e

import (
	"context"
	"crypto/sha256"
	"fmt"
	"strings"
	"testing"

	"connectrpc.com/connect"

	chatv1 "github.com/christoph/kb/modules/chat/api/go/chatv1"
	documentv1 "github.com/christoph/kb/modules/document/api/go/documentv1"
	ingestionv1 "github.com/christoph/kb/modules/ingestion/api/go/ingestionv1"
)

// TestReplaceContent uploads a new version of a document: it keeps its id
// and title, its version goes up, and its chunks come from the new file, which
// chat answers then cite under the same document. Another user can't replace
// it.
func TestReplaceContent(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), testTimeout)
	defer cancel()
	c := newClients(kb.gateway, kb.token)
	waitReady(ctx, t, c)

	const title = "Volcano version test"
	id := upload(ctx, t, c, "volcano-v1.md", title, "# Volcanoes\n\nMagma rises through cracks in the crust.\n")

	h, opt := bearer(kb.token), connect.WithGRPCWeb()
	replaceUpload := connect.NewClient[ingestionv1.ReplaceUploadRequest, ingestionv1.ReplaceUploadResponse](h, kb.gateway+ingestionv1.IngestionService_ReplaceUpload_FullMethodName, opt)
	get := connect.NewClient[documentv1.GetDocumentRequest, documentv1.GetDocumentResponse](h, kb.gateway+documentv1.DocumentService_GetDocument_FullMethodName, opt)
	listChunks := connect.NewClient[documentv1.ListChunksRequest, documentv1.ListChunksResponse](h, kb.gateway+documentv1.DocumentService_ListChunks_FullMethodName, opt)

	bobToken, err := fetchToken(kb.issuer, otherUser)
	if err != nil {
		t.Fatalf("token for %s: %v", otherUser, err)
	}
	bobReplace := connect.NewClient[ingestionv1.ReplaceUploadRequest, ingestionv1.ReplaceUploadResponse](bearer(bobToken), kb.gateway+ingestionv1.IngestionService_ReplaceUpload_FullMethodName, opt)
	if _, err := bobReplace.CallUnary(ctx, connect.NewRequest(&ingestionv1.ReplaceUploadRequest{
		DocumentId: id, Filename: "x.md", SizeBytes: 1,
	})); connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("ReplaceUpload as %s: err = %v, want %s", otherUser, err, connect.CodeNotFound)
	}

	body := "# Volcanoes, revised\n\nBasalt lava flows far because it is runny.\n"
	replaced, err := replaceUpload.CallUnary(ctx, connect.NewRequest(&ingestionv1.ReplaceUploadRequest{
		DocumentId:  id,
		Filename:    "volcano-v2.md",
		ContentType: "text/markdown",
		SizeBytes:   int64(len(body)),
		Sha256:      fmt.Sprintf("%x", sha256.Sum256([]byte(body))),
	}))
	if err != nil {
		t.Fatalf("ReplaceUpload: %v", err)
	}
	job := replaced.Msg.GetJob()
	put(ctx, t, replaced.Msg.GetUploadUrl(), job.GetContentType(), []byte(body))
	if _, err := c.completeUpload.CallUnary(ctx, connect.NewRequest(&ingestionv1.CompleteUploadRequest{JobId: job.GetId()})); err != nil {
		t.Fatalf("CompleteUpload: %v", err)
	}
	if job = watchUntilTerminal(ctx, t, c, job.GetId()); job.GetStatus() != ingestionv1.JobStatus_JOB_STATUS_DONE {
		t.Fatalf("job %s ended as %s: %q", job.GetId(), job.GetStatus(), job.GetError())
	}

	doc, err := get.CallUnary(ctx, connect.NewRequest(&documentv1.GetDocumentRequest{Id: id}))
	if err != nil {
		t.Fatalf("GetDocument: %v", err)
	}
	d := doc.Msg.GetDocument()
	if d.GetVersion() != 2 || d.GetFilename() != "volcano-v2.md" || d.GetTitle() != title ||
		d.GetStatus() != documentv1.DocumentStatus_DOCUMENT_STATUS_READY || d.GetPendingVersion() != nil {
		t.Errorf("document after the new version: %v", d)
	}
	chunks, err := listChunks.CallUnary(ctx, connect.NewRequest(&documentv1.ListChunksRequest{DocumentId: id}))
	if err != nil {
		t.Fatalf("ListChunks: %v", err)
	}
	var text strings.Builder
	for _, ch := range chunks.Msg.GetChunks() {
		text.WriteString(ch.GetText())
	}
	if !strings.Contains(text.String(), "Basalt") || strings.Contains(text.String(), "Magma") {
		t.Errorf("chunks after the new version = %q", text.String())
	}

	conv, err := c.createConversation.CallUnary(ctx, connect.NewRequest(&chatv1.CreateConversationRequest{DocumentIds: []string{id}}))
	if err != nil {
		t.Fatalf("CreateConversation: %v", err)
	}
	sources, _ := ask(ctx, t, c, conv.Msg.GetConversation().GetId(), "Why does basalt lava flow far?")
	if !cites(sources, id, title) {
		t.Errorf("sources do not cite document %s %q: %v", id, title, sources)
	}
	for _, s := range sources {
		if strings.Contains(s.GetSnippet(), "Magma") {
			t.Errorf("a source cites the old version: %v", s)
		}
	}
}
