//go:build e2e

package e2e

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	chatv1 "github.com/christoph/kb/modules/chat/api/go/chatv1"
	documentv1 "github.com/christoph/kb/modules/document/api/go/documentv1"
	ingestionv1 "github.com/christoph/kb/modules/ingestion/api/go/ingestionv1"
	llmv1 "github.com/christoph/kb/modules/llm/api/go/llmv1"
)

const (
	// testTimeout bounds the test itself, once the stack is healthy.
	testTimeout = 5 * time.Minute
	// readyTimeout bounds waiting for Envoy to route to every service.
	readyTimeout = 2 * time.Minute
)

// document is the uploaded file; the chat question shares its wording.
const document = `# Aurora smoke test

The aurora borealis appears when charged particles from the sun hit the upper atmosphere.
`

// TestUploadAndChat uploads a file through a presigned URL, waits for it to be
// processed and asks a question grounded in the knowledge base. The answer
// must cite the uploaded document.
func TestUploadAndChat(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), testTimeout)
	defer cancel()
	c := newClients(kb.gateway)
	waitReady(ctx, t, c)

	// Upload.
	const filename = "aurora-smoke.md"
	const title = "Aurora smoke test"
	created, err := c.createUpload.CallUnary(ctx, connect.NewRequest(&ingestionv1.CreateUploadRequest{
		Filename:    filename,
		ContentType: "text/markdown",
		SizeBytes:   int64(len(document)),
		Title:       title,
	}))
	if err != nil {
		t.Fatalf("CreateUpload: %v", err)
	}
	job := created.Msg.GetJob()
	put(ctx, t, created.Msg.GetUploadUrl(), []byte(document))
	if _, err := c.completeUpload.CallUnary(ctx, connect.NewRequest(&ingestionv1.CompleteUploadRequest{JobId: job.GetId()})); err != nil {
		t.Fatalf("CompleteUpload: %v", err)
	}

	// Processing.
	job = watchUntilTerminal(ctx, t, c, job.GetId())
	if job.GetStatus() != ingestionv1.JobStatus_JOB_STATUS_DONE {
		t.Fatalf("job %s ended as %s: %q", job.GetId(), job.GetStatus(), job.GetError())
	}
	if job.GetChunkCount() == 0 {
		t.Fatalf("job %s is done without chunks", job.GetId())
	}
	t.Logf("job %s done: document %s, %d chunks", job.GetId(), job.GetDocumentId(), job.GetChunkCount())

	// RAG chat.
	conv, err := c.createConversation.CallUnary(ctx, connect.NewRequest(&chatv1.CreateConversationRequest{}))
	if err != nil {
		t.Fatalf("CreateConversation: %v", err)
	}
	stream, err := c.streamChat.CallServerStream(ctx, connect.NewRequest(&chatv1.StreamChatRequest{
		ConversationId:   conv.Msg.GetConversation().GetId(),
		Content:          "When does the aurora borealis appear?",
		UseKnowledgeBase: true,
	}))
	if err != nil {
		t.Fatalf("StreamChat: %v", err)
	}
	defer func() { _ = stream.Close() }()
	var (
		sources []*chatv1.Citation
		deltas  strings.Builder
		answer  *chatv1.ChatMessage
	)
	for stream.Receive() {
		switch ev := stream.Msg().GetEvent().(type) {
		case *chatv1.StreamChatResponse_Citations:
			sources = ev.Citations.GetItems()
		case *chatv1.StreamChatResponse_Delta:
			deltas.WriteString(ev.Delta)
		case *chatv1.StreamChatResponse_Message:
			answer = ev.Message
		}
	}
	if err := stream.Err(); err != nil {
		t.Fatalf("StreamChat stream: %v", err)
	}
	if answer == nil {
		t.Fatalf("StreamChat ended without the saved answer (deltas: %q)", deltas.String())
	}
	if answer.GetContent() == "" || answer.GetContent() != deltas.String() {
		t.Errorf("saved answer %q does not match the streamed deltas %q", answer.GetContent(), deltas.String())
	}
	t.Logf("answer: %q", answer.GetContent())
	if !cites(sources, job.GetDocumentId(), title) {
		t.Errorf("streamed sources do not cite document %s %q: %v", job.GetDocumentId(), title, sources)
	}
	if !cites(answer.GetCitations(), job.GetDocumentId(), title) {
		t.Errorf("saved answer does not cite document %s %q: %v", job.GetDocumentId(), title, answer.GetCitations())
	}
}

// clients calls the services over gRPC-Web through Envoy, like the browser.
type clients struct {
	createUpload       *connect.Client[ingestionv1.CreateUploadRequest, ingestionv1.CreateUploadResponse]
	completeUpload     *connect.Client[ingestionv1.CompleteUploadRequest, ingestionv1.CompleteUploadResponse]
	watchJob           *connect.Client[ingestionv1.WatchJobRequest, ingestionv1.WatchJobResponse]
	listJobs           *connect.Client[ingestionv1.ListJobsRequest, ingestionv1.ListJobsResponse]
	listDocuments      *connect.Client[documentv1.ListDocumentsRequest, documentv1.ListDocumentsResponse]
	providerStatus     *connect.Client[llmv1.GetProviderStatusRequest, llmv1.GetProviderStatusResponse]
	createConversation *connect.Client[chatv1.CreateConversationRequest, chatv1.CreateConversationResponse]
	listConversations  *connect.Client[chatv1.ListConversationsRequest, chatv1.ListConversationsResponse]
	streamChat         *connect.Client[chatv1.StreamChatRequest, chatv1.StreamChatResponse]
}

// newClients builds connect clients from the procedure names and messages of
// the generated Go bindings (modules/*/api/go).
func newClients(gateway string) *clients {
	h := http.DefaultClient
	opt := connect.WithGRPCWeb()
	return &clients{
		createUpload:       connect.NewClient[ingestionv1.CreateUploadRequest, ingestionv1.CreateUploadResponse](h, gateway+ingestionv1.IngestionService_CreateUpload_FullMethodName, opt),
		completeUpload:     connect.NewClient[ingestionv1.CompleteUploadRequest, ingestionv1.CompleteUploadResponse](h, gateway+ingestionv1.IngestionService_CompleteUpload_FullMethodName, opt),
		watchJob:           connect.NewClient[ingestionv1.WatchJobRequest, ingestionv1.WatchJobResponse](h, gateway+ingestionv1.IngestionService_WatchJob_FullMethodName, opt),
		listJobs:           connect.NewClient[ingestionv1.ListJobsRequest, ingestionv1.ListJobsResponse](h, gateway+ingestionv1.IngestionService_ListJobs_FullMethodName, opt),
		listDocuments:      connect.NewClient[documentv1.ListDocumentsRequest, documentv1.ListDocumentsResponse](h, gateway+documentv1.DocumentService_ListDocuments_FullMethodName, opt),
		providerStatus:     connect.NewClient[llmv1.GetProviderStatusRequest, llmv1.GetProviderStatusResponse](h, gateway+llmv1.LlmService_GetProviderStatus_FullMethodName, opt),
		createConversation: connect.NewClient[chatv1.CreateConversationRequest, chatv1.CreateConversationResponse](h, gateway+chatv1.ChatService_CreateConversation_FullMethodName, opt),
		listConversations:  connect.NewClient[chatv1.ListConversationsRequest, chatv1.ListConversationsResponse](h, gateway+chatv1.ChatService_ListConversations_FullMethodName, opt),
		streamChat:         connect.NewClient[chatv1.StreamChatRequest, chatv1.StreamChatResponse](h, gateway+chatv1.ChatService_StreamChat_FullMethodName, opt),
	}
}

// waitReady polls one cheap call per module until Envoy routes to all of them.
// Compose reports the containers healthy, but Envoy resolves its upstreams on
// its own schedule.
func waitReady(ctx context.Context, t *testing.T, c *clients) {
	t.Helper()
	probes := map[string]func(context.Context) error{
		"document": func(ctx context.Context) error {
			_, err := c.listDocuments.CallUnary(ctx, connect.NewRequest(&documentv1.ListDocumentsRequest{}))
			return err
		},
		"ingestion": func(ctx context.Context) error {
			_, err := c.listJobs.CallUnary(ctx, connect.NewRequest(&ingestionv1.ListJobsRequest{}))
			return err
		},
		"chat": func(ctx context.Context) error {
			_, err := c.listConversations.CallUnary(ctx, connect.NewRequest(&chatv1.ListConversationsRequest{}))
			return err
		},
		"llm": func(ctx context.Context) error {
			res, err := c.providerStatus.CallUnary(ctx, connect.NewRequest(&llmv1.GetProviderStatusRequest{}))
			if err == nil && !res.Msg.GetHealthy() {
				err = fmt.Errorf("provider %q unhealthy: %s", res.Msg.GetProvider(), res.Msg.GetDetail())
			}
			return err
		},
	}
	deadline := time.Now().Add(readyTimeout)
	for name, probe := range probes {
		for {
			callCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			err := probe(callCtx)
			cancel()
			if err == nil {
				break
			}
			if time.Now().After(deadline) || ctx.Err() != nil {
				t.Fatalf("%s module not reachable through the gateway %s: %v", name, kb.gateway, err)
			}
			time.Sleep(time.Second)
		}
	}
}

// put uploads the file to the presigned URL, as the browser does.
func put(ctx context.Context, t *testing.T, url string, body []byte) {
	t.Helper()
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, url, bytes.NewReader(body))
	if err != nil {
		t.Fatalf("upload request: %v", err)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("upload to %s: %v", url, err)
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		t.Fatalf("upload to %s: storage answered %s", url, res.Status)
	}
}

// watchUntilTerminal follows the job with WatchJob until it is done or failed.
func watchUntilTerminal(ctx context.Context, t *testing.T, c *clients, id string) *ingestionv1.Job {
	t.Helper()
	stream, err := c.watchJob.CallServerStream(ctx, connect.NewRequest(&ingestionv1.WatchJobRequest{Id: id}))
	if err != nil {
		t.Fatalf("WatchJob: %v", err)
	}
	defer func() { _ = stream.Close() }()
	var last *ingestionv1.Job
	for stream.Receive() {
		last = stream.Msg().GetJob()
		t.Logf("job %s: %s", id, last.GetStatus())
		switch last.GetStatus() {
		case ingestionv1.JobStatus_JOB_STATUS_DONE, ingestionv1.JobStatus_JOB_STATUS_FAILED:
			return last
		}
	}
	err = stream.Err()
	if err == nil {
		err = errors.New("stream ended before the job was terminal")
	}
	t.Fatalf("WatchJob %s (last status %s): %v", id, last.GetStatus(), err)
	return nil
}

func cites(citations []*chatv1.Citation, documentID, title string) bool {
	for _, c := range citations {
		if c.GetDocumentId() == documentID && c.GetDocumentTitle() == title {
			return true
		}
	}
	return false
}
