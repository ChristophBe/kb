//go:build e2e

package e2e

import (
	"context"
	"os"
	"testing"

	"connectrpc.com/connect"

	ingestionv1 "github.com/ChristophBe/knowcelium/modules/ingestion/api/go/ingestionv1"
)

// TestCreateFromURLRefusesPrivateAddresses checks that the stack does not
// fetch from its own network: the service itself, the cloud metadata address
// and a name for the loopback interface.
func TestCreateFromURLRefusesPrivateAddresses(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), testTimeout)
	defer cancel()
	c := newClients(kb.gateway, kb.token)
	waitReady(ctx, t, c)

	for _, url := range []string{"http://ingestion-service:9102/metrics", "http://169.254.169.254/latest/meta-data/", "http://localhost:9002/"} {
		_, err := c.createFromURL.CallUnary(ctx, connect.NewRequest(&ingestionv1.CreateFromUrlRequest{Url: url}))
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Errorf("CreateFromUrl(%s): err = %v, want InvalidArgument", url, err)
		}
	}
}

// TestCreateFromURL adds a real web page, named by KNOWCEL_E2E_PAGE_URL
// (skipped without it: it needs the internet), and waits for the document.
func TestCreateFromURL(t *testing.T) {
	url := os.Getenv("KNOWCEL_E2E_PAGE_URL")
	if url == "" {
		t.Skip("KNOWCEL_E2E_PAGE_URL is not set")
	}
	ctx, cancel := context.WithTimeout(t.Context(), testTimeout)
	defer cancel()
	c := newClients(kb.gateway, kb.token)
	waitReady(ctx, t, c)

	created, err := c.createFromURL.CallUnary(ctx, connect.NewRequest(&ingestionv1.CreateFromUrlRequest{Url: url}))
	if err != nil {
		t.Fatalf("CreateFromUrl: %v", err)
	}
	job := watchUntilTerminal(ctx, t, c, created.Msg.GetJob().GetId())
	if job.GetStatus() != ingestionv1.JobStatus_JOB_STATUS_DONE || job.GetChunkCount() == 0 {
		t.Fatalf("job ended as %s with %d chunks: %q", job.GetStatus(), job.GetChunkCount(), job.GetError())
	}
	t.Logf("document %s (%s), %d chunks", job.GetDocumentId(), job.GetFilename(), job.GetChunkCount())
}
