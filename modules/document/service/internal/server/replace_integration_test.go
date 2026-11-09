//go:build integration

package server

import (
	"io"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	documentv1 "github.com/christoph/kb/modules/document/api/go/documentv1"
	"github.com/christoph/kb/modules/document/service/internal/cleanup"
)

// putFile uploads content to a presigned URL as a browser would.
func putFile(t *testing.T, url, contentType, content string) {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), http.MethodPut, url, strings.NewReader(content))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", contentType)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("upload: %s", resp.Status)
	}
}

// process plays the ingestion pipeline for a document whose file has been
// uploaded: it marks the upload, reads the content and stores one chunk per
// line, or fails with failWith. It returns the content it read.
func (h *harness) process(t *testing.T, id, failWith string) string {
	t.Helper()
	ctx := t.Context() // the pipeline runs without a user
	setStatus := func(s documentv1.DocumentStatus, detail string) {
		t.Helper()
		if _, err := h.server.SetDocumentStatus(ctx, &documentv1.SetDocumentStatusRequest{Id: id, Status: s, StatusDetail: detail}); err != nil {
			t.Fatalf("set %s: %v", s, err)
		}
	}
	setStatus(documentv1.DocumentStatus_DOCUMENT_STATUS_UPLOADED, "")
	setStatus(documentv1.DocumentStatus_DOCUMENT_STATUS_PROCESSING, "")
	stream := &readStream{ctx: ctx}
	if err := h.server.ReadContent(&documentv1.ReadContentRequest{Id: id}, stream); err != nil {
		t.Fatalf("read content: %v", err)
	}
	if failWith != "" {
		setStatus(documentv1.DocumentStatus_DOCUMENT_STATUS_FAILED, failWith)
		return string(stream.data)
	}
	var chunks []*documentv1.ChunkInput
	for i, line := range strings.Split(string(stream.data), "\n") {
		embedding := make([]float32, 768)
		embedding[i] = 1
		chunks = append(chunks, &documentv1.ChunkInput{Index: int32(i), Text: line, Embedding: embedding})
	}
	if _, err := h.server.AddChunks(ctx, &documentv1.AddChunksRequest{DocumentId: id, Chunks: chunks}); err != nil {
		t.Fatalf("add chunks: %v", err)
	}
	return string(stream.data)
}

// replace starts a new version and uploads its file.
func (h *harness) replace(t *testing.T, id, filename, content string) {
	t.Helper()
	resp, err := h.server.ReplaceContent(asAlice(t), &documentv1.ReplaceContentRequest{
		Id: id, Filename: filename, SizeBytes: int64(len(content)),
	})
	if err != nil {
		t.Fatalf("replace content: %v", err)
	}
	putFile(t, resp.GetUploadUrl(), resp.GetDocument().GetPendingVersion().GetContentType(), content)
}

func (h *harness) get(t *testing.T, id string) *documentv1.Document {
	t.Helper()
	resp, err := h.server.GetDocument(asAlice(t), &documentv1.GetDocumentRequest{Id: id})
	if err != nil {
		t.Fatal(err)
	}
	return resp.GetDocument()
}

func (h *harness) chunkTexts(t *testing.T, id string) string {
	t.Helper()
	resp, err := h.server.ListChunks(asAlice(t), &documentv1.ListChunksRequest{DocumentId: id})
	if err != nil {
		t.Fatal(err)
	}
	texts := []string{}
	for _, c := range resp.GetChunks() {
		texts = append(texts, c.GetText())
	}
	return strings.Join(texts, ",")
}

func (h *harness) keys(t *testing.T) []string {
	t.Helper()
	keys := []string{}
	for obj, err := range h.objects.List(t.Context()) {
		if err != nil {
			t.Fatal(err)
		}
		keys = append(keys, obj.Key)
	}
	slices.Sort(keys)
	return keys
}

func (h *harness) download(t *testing.T, id string) string {
	t.Helper()
	resp, err := h.server.GetDownloadUrl(asAlice(t), &documentv1.GetDownloadUrlRequest{Id: id})
	if err != nil {
		t.Fatal(err)
	}
	got, err := http.Get(resp.GetUrl()) //nolint:noctx // a test against a local container
	if err != nil {
		t.Fatal(err)
	}
	defer got.Body.Close()
	body, err := io.ReadAll(got.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(body)
}

func TestReplacingContentKeepsTheDocumentAndSwapsItsVersion(t *testing.T) {
	h := newHarness(t)
	doc := h.upload(t) // "# Notes\n", awaiting processing
	id := doc.ID.String()
	// A new version waits for the first one to be processed.
	_, err := h.server.ReplaceContent(asAlice(t), &documentv1.ReplaceContentRequest{Id: id, Filename: "b.md", SizeBytes: 3})
	if status.Code(err) != codes.FailedPrecondition {
		t.Errorf("before processing: err = %v, want FailedPrecondition", err)
	}
	h.process(t, id, "")
	if d := h.get(t, id); d.GetVersion() != 1 || d.GetPendingVersion() != nil || h.chunkTexts(t, id) != "# Notes," {
		t.Fatalf("version 1: %+v, chunks %q", d, h.chunkTexts(t, id))
	}

	// A version that fails processing leaves the document as it was, with
	// both files kept: the current one to read, the new one to retry.
	h.replace(t, id, "bad.md", "bad")
	if content := h.process(t, id, "no text"); content != "bad" {
		t.Fatalf("the pipeline read %q, want the new file", content)
	}
	d := h.get(t, id)
	if d.GetId() != id || d.GetVersion() != 1 || d.GetStatus() != documentv1.DocumentStatus_DOCUMENT_STATUS_READY ||
		d.GetFilename() != "notes.md" {
		t.Errorf("after a failed version: %+v", d)
	}
	if p := d.GetPendingVersion(); p.GetVersion() != 2 || p.GetStatus() != documentv1.DocumentStatus_DOCUMENT_STATUS_FAILED ||
		p.GetStatusDetail() != "no text" || p.GetFilename() != "bad.md" {
		t.Errorf("failed version = %+v", p)
	}
	if got := h.chunkTexts(t, id); got != "# Notes," {
		t.Errorf("chunks after a failed version = %q, want version 1's", got)
	}
	if got := h.download(t, id); got != "# Notes\n" {
		t.Errorf("download after a failed version = %q, want version 1", got)
	}
	failedKey := id + "/v2/bad.md"
	if got := h.keys(t); !slices.Equal(got, []string{doc.ObjectKey, failedKey}) {
		t.Errorf("objects after a failed version = %v", got)
	}

	// The sweeper doesn't take the pending file for an orphan.
	sweeper := cleanup.New(h.repo, h.objects, cleanup.Config{Interval: time.Hour, UploadTTL: time.Hour, OrphanGrace: time.Minute}, slog.New(slog.DiscardHandler))
	sweeper.Now = func() time.Time { return time.Now().Add(time.Hour) }
	if res, err := sweeper.Sweep(t.Context()); err != nil || res.OrphanObjects != 0 {
		t.Errorf("sweep: %+v, %v", res, err)
	}

	// The next try replaces the failed version; once processed it is current
	// and the old file is gone.
	h.replace(t, id, "notes-v2.md", "two\nbeta")
	h.process(t, id, "")
	d = h.get(t, id)
	if d.GetId() != id || d.GetVersion() != 2 || d.GetFilename() != "notes-v2.md" || d.GetSizeBytes() != 8 ||
		d.GetContentType() != "text/markdown" || d.GetStatus() != documentv1.DocumentStatus_DOCUMENT_STATUS_READY ||
		d.GetPendingVersion() != nil || d.GetTitle() != "notes.md" || d.GetChunkCount() != 2 {
		t.Errorf("version 2: %+v", d)
	}
	if got := h.chunkTexts(t, id); got != "two,beta" {
		t.Errorf("chunks of version 2 = %q", got)
	}
	if got := h.download(t, id); got != "two\nbeta" {
		t.Errorf("download of version 2 = %q", got)
	}
	if got := h.keys(t); !slices.Equal(got, []string{id + "/v2/notes-v2.md"}) {
		t.Errorf("objects after version 2 = %v", got)
	}

	// Deleting the document removes a pending version's file too.
	h.replace(t, id, "notes-v3.md", "three")
	if err := h.delete(asAlice(t), doc); err != nil {
		t.Fatal(err)
	}
	h.assertBucketEmpty(t)
}

func TestReplaceContentChecksTheUploadedFile(t *testing.T) {
	h := newHarness(t)
	doc := h.upload(t)
	id := doc.ID.String()
	h.process(t, id, "")
	resp, err := h.server.ReplaceContent(asAlice(t), &documentv1.ReplaceContentRequest{
		Id: id, Filename: "v2.md", SizeBytes: 3, Sha256: strings.Repeat("0", 64),
	})
	if err != nil {
		t.Fatal(err)
	}
	putFile(t, resp.GetUploadUrl(), "text/markdown", "abc")
	_, err = h.server.SetDocumentStatus(t.Context(), uploadedRequest(doc.ID))
	if status.Code(err) != codes.FailedPrecondition || errorReason(err) != "UPLOAD_REJECTED" {
		t.Fatalf("err = %v, want UPLOAD_REJECTED", err)
	}
	d := h.get(t, id)
	if d.GetStatus() != documentv1.DocumentStatus_DOCUMENT_STATUS_READY || d.GetVersion() != 1 ||
		d.GetPendingVersion().GetStatus() != documentv1.DocumentStatus_DOCUMENT_STATUS_FAILED {
		t.Errorf("after a rejected file: %+v", d)
	}
	// The rejected file is removed; the current one stays.
	if got := h.keys(t); !slices.Equal(got, []string{doc.ObjectKey}) {
		t.Errorf("objects = %v", got)
	}
}
