//go:build e2e

package e2e

import (
	"bytes"
	"context"
	"crypto/sha256"
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
	c := newClients(kb.gateway, kb.token)
	waitReady(ctx, t, c)

	const title = "Aurora smoke test"
	documentID := upload(ctx, t, c, "aurora-smoke.md", title, document)

	// RAG chat.
	conv, err := c.createConversation.CallUnary(ctx, connect.NewRequest(&chatv1.CreateConversationRequest{}))
	if err != nil {
		t.Fatalf("CreateConversation: %v", err)
	}
	sources, answer := ask(ctx, t, c, conv.Msg.GetConversation().GetId(), "When does the aurora borealis appear?")
	if !cites(sources, documentID, title) {
		t.Errorf("streamed sources do not cite document %s %q: %v", documentID, title, sources)
	}
	if !cites(answer.GetCitations(), documentID, title) {
		t.Errorf("saved answer does not cite document %s %q: %v", documentID, title, answer.GetCitations())
	}
}

// TestScopedChat restricts a conversation to one of two documents: answers
// cite only that one, the scope is kept, and clearing it searches everything.
func TestScopedChat(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), testTimeout)
	defer cancel()
	c := newClients(kb.gateway, kb.token)
	waitReady(ctx, t, c)

	const tidesTitle, moonTitle = "Tides scope test", "Moon scope test"
	tides := upload(ctx, t, c, "tides-scope.md", tidesTitle, "# Tides\n\nTides rise and fall twice a day because of the moon's gravity.\n")
	moon := upload(ctx, t, c, "moon-scope.md", moonTitle, "# Moon\n\nThe moon orbits the earth about once every 27 days.\n")

	created, err := c.createConversation.CallUnary(ctx, connect.NewRequest(&chatv1.CreateConversationRequest{DocumentIds: []string{moon}}))
	if err != nil {
		t.Fatalf("CreateConversation: %v", err)
	}
	id := created.Msg.GetConversation().GetId()
	const question = "Why do tides rise and fall?"
	sources, answer := ask(ctx, t, c, id, question)
	if len(sources) == 0 || !cites(sources, moon, moonTitle) {
		t.Errorf("scoped sources do not cite the scoped document %s: %v", moon, sources)
	}
	for _, cit := range append(sources, answer.GetCitations()...) {
		if cit.GetDocumentId() != moon {
			t.Errorf("scoped answer cites document %s %q outside the scope", cit.GetDocumentId(), cit.GetDocumentTitle())
		}
	}

	got, err := c.getConversation.CallUnary(ctx, connect.NewRequest(&chatv1.GetConversationRequest{Id: id}))
	if err != nil {
		t.Fatalf("GetConversation: %v", err)
	}
	if ids := got.Msg.GetConversation().GetDocumentIds(); len(ids) != 1 || ids[0] != moon {
		t.Errorf("reloaded scope = %v, want [%s]", ids, moon)
	}

	// An empty scope means all documents.
	if _, err := c.updateConversation.CallUnary(ctx, connect.NewRequest(&chatv1.UpdateConversationRequest{Id: id, DocumentIds: &chatv1.DocumentIds{}})); err != nil {
		t.Fatalf("UpdateConversation: %v", err)
	}
	sources, _ = ask(ctx, t, c, id, question)
	if !cites(sources, tides, tidesTitle) {
		t.Errorf("unscoped sources do not cite document %s %q: %v", tides, tidesTitle, sources)
	}
}

// TestInternalRPCsAreNotRouted checks that methods marked internal in the
// module manifests are not reachable through the gateway, while the uploads
// and chats of the other tests show the services still call them directly.
func TestInternalRPCsAreNotRouted(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), testTimeout)
	defer cancel()
	c := newClients(kb.gateway, kb.token)
	waitReady(ctx, t, c)

	h, opt := bearer(kb.token), connect.WithGRPCWeb()
	calls := map[string]func(context.Context) error{
		documentv1.DocumentService_AddChunks_FullMethodName: func(ctx context.Context) error {
			client := connect.NewClient[documentv1.AddChunksRequest, documentv1.AddChunksResponse](h, kb.gateway+documentv1.DocumentService_AddChunks_FullMethodName, opt)
			_, err := client.CallUnary(ctx, connect.NewRequest(&documentv1.AddChunksRequest{}))
			return err
		},
		documentv1.DocumentService_SetDocumentStatus_FullMethodName: func(ctx context.Context) error {
			client := connect.NewClient[documentv1.SetDocumentStatusRequest, documentv1.SetDocumentStatusResponse](h, kb.gateway+documentv1.DocumentService_SetDocumentStatus_FullMethodName, opt)
			_, err := client.CallUnary(ctx, connect.NewRequest(&documentv1.SetDocumentStatusRequest{}))
			return err
		},
		documentv1.DocumentService_ReplaceContent_FullMethodName: func(ctx context.Context) error {
			client := connect.NewClient[documentv1.ReplaceContentRequest, documentv1.ReplaceContentResponse](h, kb.gateway+documentv1.DocumentService_ReplaceContent_FullMethodName, opt)
			_, err := client.CallUnary(ctx, connect.NewRequest(&documentv1.ReplaceContentRequest{}))
			return err
		},
		llmv1.LlmService_Embed_FullMethodName: func(ctx context.Context) error {
			client := connect.NewClient[llmv1.EmbedRequest, llmv1.EmbedResponse](h, kb.gateway+llmv1.LlmService_Embed_FullMethodName, opt)
			_, err := client.CallUnary(ctx, connect.NewRequest(&llmv1.EmbedRequest{Inputs: []string{"x"}}))
			return err
		},
		llmv1.LlmService_Generate_FullMethodName: func(ctx context.Context) error {
			client := connect.NewClient[llmv1.GenerateRequest, llmv1.GenerateResponse](h, kb.gateway+llmv1.LlmService_Generate_FullMethodName, opt)
			stream, err := client.CallServerStream(ctx, connect.NewRequest(&llmv1.GenerateRequest{}))
			if err != nil {
				return err
			}
			defer stream.Close()
			for stream.Receive() {
			}
			return stream.Err()
		},
	}
	for method, call := range calls {
		if err := call(ctx); connect.CodeOf(err) != connect.CodeUnimplemented {
			t.Errorf("%s through the gateway: err = %v, want code %s", method, err, connect.CodeUnimplemented)
		}
	}
}

// upload uploads a file through its presigned URL, waits until it is processed
// and returns the id of its document.
func upload(ctx context.Context, t *testing.T, c *clients, filename, title, body string) string {
	t.Helper()
	created, err := c.createUpload.CallUnary(ctx, connect.NewRequest(&ingestionv1.CreateUploadRequest{
		Filename:    filename,
		ContentType: "text/markdown",
		SizeBytes:   int64(len(body)),
		Title:       title,
		Sha256:      fmt.Sprintf("%x", sha256.Sum256([]byte(body))),
	}))
	if err != nil {
		t.Fatalf("CreateUpload: %v", err)
	}
	job := created.Msg.GetJob()
	put(ctx, t, created.Msg.GetUploadUrl(), job.GetContentType(), []byte(body))
	if _, err := c.completeUpload.CallUnary(ctx, connect.NewRequest(&ingestionv1.CompleteUploadRequest{JobId: job.GetId()})); err != nil {
		t.Fatalf("CompleteUpload: %v", err)
	}

	job = watchUntilTerminal(ctx, t, c, job.GetId())
	if job.GetStatus() != ingestionv1.JobStatus_JOB_STATUS_DONE {
		t.Fatalf("job %s ended as %s: %q", job.GetId(), job.GetStatus(), job.GetError())
	}
	if job.GetChunkCount() == 0 {
		t.Fatalf("job %s is done without chunks", job.GetId())
	}
	t.Logf("job %s done: document %s, %d chunks", job.GetId(), job.GetDocumentId(), job.GetChunkCount())
	return job.GetDocumentId()
}

// ask streams a question grounded in the knowledge base and returns the
// streamed sources and the saved answer.
func ask(ctx context.Context, t *testing.T, c *clients, conversationID, question string) ([]*chatv1.Citation, *chatv1.ChatMessage) {
	t.Helper()
	stream, err := c.streamChat.CallServerStream(ctx, connect.NewRequest(&chatv1.StreamChatRequest{
		ConversationId:   conversationID,
		Content:          question,
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
	return sources, answer
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
	getConversation    *connect.Client[chatv1.GetConversationRequest, chatv1.GetConversationResponse]
	updateConversation *connect.Client[chatv1.UpdateConversationRequest, chatv1.UpdateConversationResponse]
	listConversations  *connect.Client[chatv1.ListConversationsRequest, chatv1.ListConversationsResponse]
	streamChat         *connect.Client[chatv1.StreamChatRequest, chatv1.StreamChatResponse]
}

// newClients builds connect clients from the procedure names and messages of
// the generated Go bindings (modules/*/api/go). They authenticate with token;
// an empty token sends none.
func newClients(gateway, token string) *clients {
	h := bearer(token)
	opt := connect.WithGRPCWeb()
	return &clients{
		createUpload:       connect.NewClient[ingestionv1.CreateUploadRequest, ingestionv1.CreateUploadResponse](h, gateway+ingestionv1.IngestionService_CreateUpload_FullMethodName, opt),
		completeUpload:     connect.NewClient[ingestionv1.CompleteUploadRequest, ingestionv1.CompleteUploadResponse](h, gateway+ingestionv1.IngestionService_CompleteUpload_FullMethodName, opt),
		watchJob:           connect.NewClient[ingestionv1.WatchJobRequest, ingestionv1.WatchJobResponse](h, gateway+ingestionv1.IngestionService_WatchJob_FullMethodName, opt),
		listJobs:           connect.NewClient[ingestionv1.ListJobsRequest, ingestionv1.ListJobsResponse](h, gateway+ingestionv1.IngestionService_ListJobs_FullMethodName, opt),
		listDocuments:      connect.NewClient[documentv1.ListDocumentsRequest, documentv1.ListDocumentsResponse](h, gateway+documentv1.DocumentService_ListDocuments_FullMethodName, opt),
		providerStatus:     connect.NewClient[llmv1.GetProviderStatusRequest, llmv1.GetProviderStatusResponse](h, gateway+llmv1.LlmService_GetProviderStatus_FullMethodName, opt),
		createConversation: connect.NewClient[chatv1.CreateConversationRequest, chatv1.CreateConversationResponse](h, gateway+chatv1.ChatService_CreateConversation_FullMethodName, opt),
		getConversation:    connect.NewClient[chatv1.GetConversationRequest, chatv1.GetConversationResponse](h, gateway+chatv1.ChatService_GetConversation_FullMethodName, opt),
		updateConversation: connect.NewClient[chatv1.UpdateConversationRequest, chatv1.UpdateConversationResponse](h, gateway+chatv1.ChatService_UpdateConversation_FullMethodName, opt),
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

// put uploads the file to the presigned URL, as the browser does: with the
// content type the URL is signed for.
func put(ctx context.Context, t *testing.T, url, contentType string, body []byte) {
	t.Helper()
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, url, bytes.NewReader(body))
	if err != nil {
		t.Fatalf("upload request: %v", err)
	}
	req.Header.Set("Content-Type", contentType)
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
