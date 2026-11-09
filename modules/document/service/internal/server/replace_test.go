package server

import (
	"context"
	"io"
	"io/fs"
	"log/slog"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	documentv1 "github.com/christoph/kb/modules/document/api/go/documentv1"
	"github.com/christoph/kb/modules/document/service/internal/store"
	"github.com/christoph/kb/platform/go/grpcserver"
)

// The fake's pending-version queries behave like the SQL: they act on f.doc.

func (f *fakeRepo) StartPendingVersion(_ context.Context, p store.StartPendingVersionParams) (store.DocumentDocument, error) {
	if f.doc.ID != p.ID || owner(f.doc) != p.OwnerID || busy(f.doc) {
		return store.DocumentDocument{}, pgx.ErrNoRows
	}
	f.doc.PendingStatus, f.doc.PendingStatusDetail = p.PendingStatus, ""
	f.doc.PendingObjectKey, f.doc.PendingFilename = p.PendingObjectKey, p.PendingFilename
	f.doc.PendingContentType, f.doc.PendingSizeBytes, f.doc.PendingSha256 = p.PendingContentType, p.PendingSizeBytes, p.PendingSha256
	return f.doc, nil
}

func (f *fakeRepo) SetPendingStatus(_ context.Context, p store.SetPendingStatusParams) (store.DocumentDocument, error) {
	if f.doc.ID != p.ID || !pending(f.doc) {
		return store.DocumentDocument{}, pgx.ErrNoRows
	}
	f.doc.PendingStatus, f.doc.PendingStatusDetail = p.PendingStatus, p.PendingStatusDetail
	return f.doc, nil
}

func (f *fakeRepo) MarkPendingUploaded(_ context.Context, p store.MarkPendingUploadedParams) (store.DocumentDocument, error) {
	if f.doc.ID != p.ID || !pending(f.doc) {
		return store.DocumentDocument{}, pgx.ErrNoRows
	}
	f.doc.PendingStatus, f.doc.PendingStatusDetail = p.PendingStatus, p.PendingStatusDetail
	f.doc.PendingSizeBytes, f.doc.PendingContentType = p.PendingSizeBytes, p.PendingContentType
	return f.doc, nil
}

// recordingObjects is a fakeObjects that remembers the keys it deleted and
// opened.
type recordingObjects struct {
	fakeObjects
	deleted, opened, statted *[]string
}

func newRecordingObjects(base fakeObjects) recordingObjects {
	return recordingObjects{fakeObjects: base, deleted: &[]string{}, opened: &[]string{}, statted: &[]string{}}
}

func (r recordingObjects) Delete(_ context.Context, key string) error {
	*r.deleted = append(*r.deleted, key)
	return nil
}

func (r recordingObjects) Open(ctx context.Context, key string) (io.ReadCloser, error) {
	*r.opened = append(*r.opened, key)
	return r.fakeObjects.Open(ctx, key)
}

func (r recordingObjects) Stat(ctx context.Context, key string) (int64, string, error) {
	*r.statted = append(*r.statted, key)
	return r.fakeObjects.Stat(ctx, key)
}

const ready = int16(documentv1.DocumentStatus_DOCUMENT_STATUS_READY)

func readyDoc() store.DocumentDocument {
	id := uuid.New()
	return store.DocumentDocument{
		ID: id, OwnerID: alice, Filename: "a.md", ContentType: "text/markdown", ObjectKey: id.String() + "/a.md",
		Status: ready, Version: 1,
	}
}

func replaceRequest(id uuid.UUID) *documentv1.ReplaceContentRequest {
	return &documentv1.ReplaceContentRequest{Id: id.String(), Filename: "b.md", SizeBytes: 3}
}

func TestReplaceContentStartsAPendingVersion(t *testing.T) {
	repo := &fakeRepo{doc: readyDoc()}
	resp, err := newServer(repo).ReplaceContent(asAlice(t), replaceRequest(repo.doc.ID))
	if err != nil {
		t.Fatal(err)
	}
	d := resp.GetDocument()
	if d.GetId() != repo.doc.ID.String() || d.GetVersion() != 1 || d.GetFilename() != "a.md" {
		t.Errorf("document changed: %+v", d)
	}
	p := d.GetPendingVersion()
	if p.GetVersion() != 2 || p.GetFilename() != "b.md" || p.GetContentType() != "text/markdown" ||
		p.GetStatus() != documentv1.DocumentStatus_DOCUMENT_STATUS_PENDING_UPLOAD {
		t.Errorf("pending version = %+v", p)
	}
	want := "http://s3/" + repo.doc.ID.String() + "/v2/b.md?type=text/markdown&size=3"
	if resp.GetUploadUrl() != want {
		t.Errorf("upload url = %q, want %q", resp.GetUploadUrl(), want)
	}
}

func TestReplaceContentValidatesTheFile(t *testing.T) {
	repo := &fakeRepo{doc: readyDoc()}
	for name, req := range map[string]*documentv1.ReplaceContentRequest{
		"no filename": {Id: repo.doc.ID.String(), SizeBytes: 3},
		"empty":       {Id: repo.doc.ID.String(), Filename: "b.md"},
		"too large":   {Id: repo.doc.ID.String(), Filename: "b.md", SizeBytes: 50<<20 + 1},
		"type":        {Id: repo.doc.ID.String(), Filename: "b.exe", ContentType: "application/x-msdownload", SizeBytes: 3},
		"checksum":    {Id: repo.doc.ID.String(), Filename: "b.md", SizeBytes: 3, Sha256: "nope"},
		"id":          {Id: "nope", Filename: "b.md", SizeBytes: 3},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := newServer(repo).ReplaceContent(asAlice(t), req)
			if status.Code(err) != codes.InvalidArgument || len(grpcserver.FieldViolations(err)) == 0 {
				t.Errorf("err = %v, want field violations", err)
			}
		})
	}
	if pending(repo.doc) {
		t.Error("a pending version was started")
	}
}

func TestReplaceContentRefusesABusyDocument(t *testing.T) {
	for name, change := range map[string]func(*store.DocumentDocument){
		"awaiting first upload": func(d *store.DocumentDocument) { d.Status = 1 },
		"processing":            func(d *store.DocumentDocument) { d.Status = 3 },
		"version uploaded":      func(d *store.DocumentDocument) { d.PendingStatus = 2 },
		"version processing":    func(d *store.DocumentDocument) { d.PendingStatus = 3 },
	} {
		t.Run(name, func(t *testing.T) {
			doc := readyDoc()
			change(&doc)
			_, err := newServer(&fakeRepo{doc: doc}).ReplaceContent(asAlice(t), replaceRequest(doc.ID))
			if status.Code(err) != codes.FailedPrecondition || !strings.Contains(err.Error(), "still being") {
				t.Errorf("err = %v, want FailedPrecondition", err)
			}
		})
	}
}

func TestReplaceContentReplacesAWaitingOrFailedVersion(t *testing.T) {
	for _, pendingStatus := range []int16{1, 5} {
		doc := readyDoc()
		doc.Status = int16(documentv1.DocumentStatus_DOCUMENT_STATUS_FAILED) // a failed first upload can be replaced too
		doc.PendingStatus, doc.PendingObjectKey = pendingStatus, doc.ID.String()+"/v2/old.md"
		objects := newRecordingObjects(fakeObjects{})
		srv := New(&fakeRepo{doc: doc}, objects, &fakeLLM{}, testLimits, slog.New(slog.DiscardHandler))
		if _, err := srv.ReplaceContent(asAlice(t), replaceRequest(doc.ID)); err != nil {
			t.Fatalf("pending status %d: %v", pendingStatus, err)
		}
		if got := *objects.deleted; len(got) != 1 || got[0] != doc.PendingObjectKey {
			t.Errorf("pending status %d: deleted %v, want the previous pending file", pendingStatus, got)
		}
	}
}

func TestReplaceContentIsOwnerScoped(t *testing.T) {
	doc := readyDoc()
	doc.OwnerID = bob
	repo := &fakeRepo{doc: doc}
	if _, err := newServer(repo).ReplaceContent(asAlice(t), replaceRequest(doc.ID)); status.Code(err) != codes.NotFound {
		t.Errorf("another user's document: err = %v, want NotFound", err)
	}
	if _, err := newServer(repo).ReplaceContent(t.Context(), replaceRequest(doc.ID)); status.Code(err) != codes.Unauthenticated {
		t.Errorf("without a user: err = %v, want Unauthenticated", err)
	}
	if pending(repo.doc) {
		t.Error("a pending version was started")
	}
}

func pendingDoc(pendingStatus int16) store.DocumentDocument {
	doc := readyDoc()
	doc.PendingStatus, doc.PendingObjectKey, doc.PendingFilename = pendingStatus, doc.ID.String()+"/v2/b.md", "b.md"
	doc.PendingContentType, doc.PendingSizeBytes = "text/markdown", 3
	return doc
}

func TestStatusesApplyToThePendingVersion(t *testing.T) {
	repo := &fakeRepo{doc: pendingDoc(2)}
	resp, err := newServer(repo).SetDocumentStatus(t.Context(), &documentv1.SetDocumentStatusRequest{
		Id: repo.doc.ID.String(), Status: documentv1.DocumentStatus_DOCUMENT_STATUS_FAILED, StatusDetail: "no text",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(repo.statuses) != 0 {
		t.Errorf("the document's own status was set: %+v", repo.statuses)
	}
	d := resp.GetDocument()
	if d.GetStatus() != documentv1.DocumentStatus_DOCUMENT_STATUS_READY ||
		d.GetPendingVersion().GetStatus() != documentv1.DocumentStatus_DOCUMENT_STATUS_FAILED ||
		d.GetPendingVersion().GetStatusDetail() != "no text" {
		t.Errorf("document = %+v", d)
	}
}

func TestSetUploadedChecksThePendingFile(t *testing.T) {
	repo := &fakeRepo{doc: pendingDoc(1)}
	objects := newRecordingObjects(fakeObjects{size: 3, contentType: "application/octet-stream"})
	srv := New(repo, objects, &fakeLLM{}, testLimits, slog.New(slog.DiscardHandler))
	resp, err := srv.SetDocumentStatus(t.Context(), uploadedRequest(repo.doc.ID))
	if err != nil {
		t.Fatal(err)
	}
	if got := *objects.statted; len(got) != 1 || got[0] != repo.doc.PendingObjectKey {
		t.Errorf("checked %v, want the pending file", got)
	}
	p := resp.GetDocument().GetPendingVersion()
	if p.GetStatus() != documentv1.DocumentStatus_DOCUMENT_STATUS_UPLOADED || p.GetContentType() != "text/markdown" {
		t.Errorf("pending version = %+v", p)
	}
	if len(repo.marked) != 0 || resp.GetDocument().GetStatus() != documentv1.DocumentStatus_DOCUMENT_STATUS_READY {
		t.Errorf("the document itself was marked: %+v", repo.marked)
	}
}

func TestSetUploadedRejectsAPendingFileButKeepsTheDocument(t *testing.T) {
	repo := &fakeRepo{doc: pendingDoc(1)}
	objects := newRecordingObjects(fakeObjects{size: 50<<20 + 1})
	srv := New(repo, objects, &fakeLLM{}, testLimits, slog.New(slog.DiscardHandler))
	_, err := srv.SetDocumentStatus(t.Context(), uploadedRequest(repo.doc.ID))
	if status.Code(err) != codes.FailedPrecondition || errorReason(err) != "UPLOAD_REJECTED" {
		t.Fatalf("err = %v, want UPLOAD_REJECTED", err)
	}
	if repo.doc.Status != ready || repo.doc.PendingStatus != int16(documentv1.DocumentStatus_DOCUMENT_STATUS_FAILED) ||
		!strings.Contains(repo.doc.PendingStatusDetail, "larger than") {
		t.Errorf("document = %+v", repo.doc)
	}
	if got := *objects.deleted; len(got) != 1 || got[0] != repo.doc.PendingObjectKey {
		t.Errorf("deleted %v, want the rejected file", got)
	}
}

func TestReadContentReadsThePendingFileOnceUploaded(t *testing.T) {
	for pendingStatus, wantCurrent := range map[int16]bool{0: true, 1: true, 2: false, 3: false, 5: false} {
		doc := pendingDoc(pendingStatus)
		objects := newRecordingObjects(fakeObjects{})
		srv := New(&fakeRepo{doc: doc}, objects, &fakeLLM{}, testLimits, slog.New(slog.DiscardHandler))
		if err := srv.ReadContent(&documentv1.ReadContentRequest{Id: doc.ID.String()}, &readStream{ctx: t.Context()}); err != nil {
			t.Fatal(err)
		}
		want := doc.PendingObjectKey
		if wantCurrent {
			want = doc.ObjectKey
		}
		if got := *objects.opened; len(got) != 1 || got[0] != want {
			t.Errorf("pending status %d: opened %v, want %s", pendingStatus, got, want)
		}
	}
}

func TestReadContentOfARemovedPendingFile(t *testing.T) {
	doc := pendingDoc(5)
	srv := New(&fakeRepo{doc: doc}, fakeObjects{statErr: fs.ErrNotExist}, &fakeLLM{}, testLimits, slog.New(slog.DiscardHandler))
	err := srv.ReadContent(&documentv1.ReadContentRequest{Id: doc.ID.String()}, &readStream{ctx: t.Context()})
	if status.Code(err) != codes.FailedPrecondition {
		t.Errorf("err = %v, want FailedPrecondition", err)
	}
}
