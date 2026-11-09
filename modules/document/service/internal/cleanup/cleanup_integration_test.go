//go:build integration

package cleanup

import (
	"context"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	documentv1 "github.com/christoph/kb/modules/document/api/go/documentv1"
	"github.com/christoph/kb/modules/document/migrations"
	"github.com/christoph/kb/modules/document/service/internal/storage"
	"github.com/christoph/kb/modules/document/service/internal/storage/s3test"
	"github.com/christoph/kb/modules/document/service/internal/store"
	"github.com/christoph/kb/platform/go/postgres/pgtest"
)

var testConfig = Config{Interval: time.Hour, UploadTTL: 24 * time.Hour, OrphanGrace: time.Hour}

type harness struct {
	repo    *store.Repo
	objects *storage.S3
	sweeper *Sweeper
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	h := &harness{
		repo:    store.NewRepo(pgtest.Start(t, "document", migrations.FS, store.ConfigurePool)),
		objects: s3test.Start(t),
	}
	h.sweeper = New(h.repo, h.objects, testConfig, slog.New(slog.DiscardHandler))
	return h
}

// document creates a document in status, with its file uploaded if uploaded.
func (h *harness) document(t *testing.T, status documentv1.DocumentStatus, uploaded bool) store.DocumentDocument {
	t.Helper()
	id := uuid.New()
	doc, err := h.repo.CreateDocument(t.Context(), store.CreateDocumentParams{
		ID: id, OwnerID: "alice", Title: "a.md", Filename: "a.md", ContentType: "text/markdown",
		ObjectKey: id.String() + "/a.md", Status: int16(status), Metadata: map[string]string{},
	})
	if err != nil {
		t.Fatal(err)
	}
	if uploaded {
		h.put(t, doc.ObjectKey)
	}
	return doc
}

// put uploads an object the way browsers do, through a presigned URL.
func (h *harness) put(t *testing.T, key string) {
	t.Helper()
	const content = "# A\n"
	u, err := h.objects.PresignPut(t.Context(), key, "text/markdown", int64(len(content)))
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequestWithContext(t.Context(), http.MethodPut, u, strings.NewReader(content))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "text/markdown")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("put %s: %s", key, resp.Status)
	}
}

// sweepAt sweeps as if it were d from now.
func (h *harness) sweepAt(t *testing.T, d time.Duration) Result {
	t.Helper()
	h.sweeper.Now = func() time.Time { return time.Now().Add(d) }
	res, err := h.sweeper.Sweep(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func (h *harness) hasRow(t *testing.T, doc store.DocumentDocument) bool {
	t.Helper()
	_, err := h.repo.GetAnyDocument(t.Context(), doc.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false
	}
	if err != nil {
		t.Fatal(err)
	}
	return true
}

func (h *harness) hasObject(t *testing.T, key string) bool {
	t.Helper()
	_, _, err := h.objects.Stat(t.Context(), key)
	if errors.Is(err, fs.ErrNotExist) {
		return false
	}
	if err != nil {
		t.Fatal(err)
	}
	return true
}

func TestSweepRemovesUploadsAbandonedForLongerThanTheTTL(t *testing.T) {
	h := newHarness(t)
	// Uploaded but never completed, never uploaded, and a completed one.
	abandoned := h.document(t, documentv1.DocumentStatus_DOCUMENT_STATUS_PENDING_UPLOAD, true)
	empty := h.document(t, documentv1.DocumentStatus_DOCUMENT_STATUS_PENDING_UPLOAD, false)
	ready := h.document(t, documentv1.DocumentStatus_DOCUMENT_STATUS_READY, true)

	if res := h.sweepAt(t, testConfig.UploadTTL-time.Minute); res.StaleUploads != 0 {
		t.Fatalf("before the TTL: %+v, want nothing removed", res)
	}
	if !h.hasRow(t, abandoned) || !h.hasRow(t, empty) {
		t.Fatal("fresh uploads were removed")
	}

	if res := h.sweepAt(t, testConfig.UploadTTL+time.Minute); res.StaleUploads != 2 {
		t.Errorf("after the TTL: %+v, want 2 stale uploads", res)
	}
	if h.hasRow(t, abandoned) || h.hasObject(t, abandoned.ObjectKey) || h.hasRow(t, empty) {
		t.Error("an abandoned upload is left")
	}
	if !h.hasRow(t, ready) || !h.hasObject(t, ready.ObjectKey) {
		t.Error("the completed document was removed")
	}
}

func TestSweepRemovesObjectsWithoutADocumentAfterTheGracePeriod(t *testing.T) {
	h := newHarness(t)
	ready := h.document(t, documentv1.DocumentStatus_DOCUMENT_STATUS_READY, true)
	orphan := uuid.NewString() + "/gone.md"
	h.put(t, orphan)

	if res := h.sweepAt(t, 0); res.OrphanObjects != 0 || !h.hasObject(t, orphan) {
		t.Fatalf("within the grace period: %+v, want the object kept", res)
	}
	if res := h.sweepAt(t, testConfig.OrphanGrace+time.Minute); res.OrphanObjects != 1 {
		t.Errorf("after the grace period: %+v, want 1 orphan", res)
	}
	if h.hasObject(t, orphan) {
		t.Error("the orphan is left")
	}
	if !h.hasObject(t, ready.ObjectKey) {
		t.Error("a document's object was removed")
	}
}

func TestSweepIsSkippedWhileAnotherReplicaSweeps(t *testing.T) {
	h := newHarness(t)
	h.document(t, documentv1.DocumentStatus_DOCUMENT_STATUS_PENDING_UPLOAD, false)
	h.sweeper.Now = func() time.Time { return time.Now().Add(testConfig.UploadTTL + time.Minute) }

	locked, err := h.repo.WithLock(t.Context(), lockKey, func(ctx context.Context) error {
		res, err := h.sweeper.Sweep(ctx)
		if err != nil {
			return err
		}
		if !res.Skipped || res.StaleUploads != 0 {
			t.Errorf("sweep under another's lock: %+v, want skipped", res)
		}
		return nil
	})
	if err != nil || !locked {
		t.Fatalf("locked = %v, err = %v", locked, err)
	}
	if res := h.sweepAt(t, testConfig.UploadTTL+time.Minute); res.Skipped || res.StaleUploads != 1 {
		t.Errorf("sweep after the lock was released: %+v", res)
	}
}
