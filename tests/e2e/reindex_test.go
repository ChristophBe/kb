//go:build e2e

package e2e

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	documentv1 "github.com/ChristophBe/knowcelium/modules/document/api/go/documentv1"
	ingestionv1 "github.com/ChristophBe/knowcelium/modules/ingestion/api/go/ingestionv1"
)

// TestReindexDocuments reindexes a document through the document module's
// event and the ingestion consumer: nothing is outdated on the current model,
// a forced reindex processes the document again, and it stays searchable.
// Another user can't reindex it. (Changing the model itself needs a restart
// of the llm service, which docs/operations/embedding-model.md describes.)
func TestReindexDocuments(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), testTimeout)
	defer cancel()
	c := newClients(kb.gateway, kb.token)
	waitReady(ctx, t, c)

	const title = "Reindex test glaciers"
	id := upload(ctx, t, c, "glaciers.md", title, "# Glaciers\n\nAnkylosaurus-free ice flows slowly downhill.\n")

	h, opt := bearer(kb.token), connect.WithGRPCWeb()
	reindex := connect.NewClient[documentv1.ReindexDocumentsRequest, documentv1.ReindexDocumentsResponse](h, kb.gateway+documentv1.DocumentService_ReindexDocuments_FullMethodName, opt)
	search := connect.NewClient[documentv1.SearchDocumentsRequest, documentv1.SearchDocumentsResponse](h, kb.gateway+documentv1.DocumentService_SearchDocuments_FullMethodName, opt)

	found := func(when string) {
		t.Helper()
		resp, err := search.CallUnary(ctx, connect.NewRequest(&documentv1.SearchDocumentsRequest{
			Query: "How do glaciers flow?", DocumentIds: []string{id},
		}))
		if err != nil {
			t.Fatalf("SearchDocuments %s: %v", when, err)
		}
		if len(resp.Msg.GetDocuments()) != 1 || resp.Msg.GetDocuments()[0].GetDocumentId() != id {
			t.Errorf("search %s = %v, want the document", when, resp.Msg.GetDocuments())
		}
	}
	found("before the reindex")

	// On the current model there is nothing to do.
	resp, err := reindex.CallUnary(ctx, connect.NewRequest(&documentv1.ReindexDocumentsRequest{DocumentIds: []string{id}}))
	if err != nil {
		t.Fatalf("ReindexDocuments: %v", err)
	}
	if resp.Msg.GetRequested() != 0 || resp.Msg.GetEmbeddingModel() == "" {
		t.Errorf("reindex without force = %v, want nothing requested and the model", resp.Msg)
	}

	bobToken, err := fetchToken(kb.issuer, otherUser)
	if err != nil {
		t.Fatalf("token for %s: %v", otherUser, err)
	}
	bobReindex := connect.NewClient[documentv1.ReindexDocumentsRequest, documentv1.ReindexDocumentsResponse](bearer(bobToken), kb.gateway+documentv1.DocumentService_ReindexDocuments_FullMethodName, opt)
	if _, err := bobReindex.CallUnary(ctx, connect.NewRequest(&documentv1.ReindexDocumentsRequest{DocumentIds: []string{id}, Force: true})); connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("ReindexDocuments as %s: err = %v, want %s", otherUser, err, connect.CodePermissionDenied)
	}

	before := jobOf(ctx, t, c, id).GetUpdateTime().AsTime()
	resp, err = reindex.CallUnary(ctx, connect.NewRequest(&documentv1.ReindexDocumentsRequest{DocumentIds: []string{id}, Force: true}))
	if err != nil {
		t.Fatalf("ReindexDocuments force: %v", err)
	}
	if resp.Msg.GetRequested() != 1 {
		t.Fatalf("forced reindex = %v, want the document requested", resp.Msg)
	}
	// The ingestion service consumes the event and runs the job again.
	for {
		job := jobOf(ctx, t, c, id)
		if job.GetUpdateTime().AsTime().After(before) && job.GetStatus() == ingestionv1.JobStatus_JOB_STATUS_DONE {
			break
		}
		if job.GetStatus() == ingestionv1.JobStatus_JOB_STATUS_FAILED {
			t.Fatalf("the reindex failed: %q", job.GetError())
		}
		select {
		case <-ctx.Done():
			t.Fatalf("the job did not run again (status %s)", job.GetStatus())
		case <-time.After(500 * time.Millisecond):
		}
	}
	found("after the reindex")
}

// jobOf returns the job of a document.
func jobOf(ctx context.Context, t *testing.T, c *clients, documentID string) *ingestionv1.Job {
	t.Helper()
	resp, err := c.listJobs.CallUnary(ctx, connect.NewRequest(&ingestionv1.ListJobsRequest{}))
	if err != nil {
		t.Fatalf("ListJobs: %v", err)
	}
	for _, j := range resp.Msg.GetJobs() {
		if j.GetDocumentId() == documentID {
			return j
		}
	}
	t.Fatalf("no job for document %s", documentID)
	return nil
}
