package documents

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	documentv1 "github.com/christoph/kb/modules/document/api/go/documentv1"
	"github.com/christoph/kb/modules/ingestion/service/internal/app"
	"github.com/christoph/kb/platform/go/grpcserver"
)

type fakeClient struct {
	documentv1.DocumentServiceClient
	err error
	id  string
}

func (f fakeClient) CreateDocument(context.Context, *documentv1.CreateDocumentRequest, ...grpc.CallOption) (*documentv1.CreateDocumentResponse, error) {
	if f.err != nil {
		return nil, f.err
	}
	return &documentv1.CreateDocumentResponse{Document: &documentv1.Document{Id: f.id}}, nil
}

func (f fakeClient) SetDocumentStatus(context.Context, *documentv1.SetDocumentStatusRequest, ...grpc.CallOption) (*documentv1.SetDocumentStatusResponse, error) {
	return &documentv1.SetDocumentStatusResponse{}, f.err
}

func TestPeerAvailabilityBecomesAnApplicationError(t *testing.T) {
	for _, code := range []codes.Code{codes.Unavailable, codes.DeadlineExceeded} {
		t.Run(code.String(), func(t *testing.T) {
			c := New(fakeClient{err: status.Error(code, "down")})
			if _, err := c.Create(t.Context(), app.NewUpload{}); !errors.Is(err, app.ErrDocumentsUnavailable) {
				t.Errorf("create: %v", err)
			}
			if err := c.MarkUploaded(t.Context(), uuid.New()); !errors.Is(err, app.ErrDocumentsUnavailable) {
				t.Errorf("mark uploaded: %v", err)
			}
		})
	}
}

func TestMissingFileIsAnApplicationError(t *testing.T) {
	c := New(fakeClient{err: status.Error(codes.FailedPrecondition, "not uploaded")})
	if err := c.MarkUploaded(t.Context(), uuid.New()); !errors.Is(err, app.ErrUploadMissing) {
		t.Fatalf("err = %v", err)
	}
}

func TestRejectedFileIsAnApplicationError(t *testing.T) {
	c := New(fakeClient{err: grpcserver.WithDetails(codes.FailedPrecondition, "The uploaded file does not match its checksum",
		grpcserver.ErrorInfo("kb.document.v1", "UPLOAD_REJECTED", nil))})
	var rejected *app.UploadRejectedError
	if err := c.MarkUploaded(t.Context(), uuid.New()); !errors.As(err, &rejected) || rejected.Reason != "The uploaded file does not match its checksum" {
		t.Fatalf("err = %v, want the rejection with its reason", err)
	}
}

func TestInvalidUploadKeepsTheViolations(t *testing.T) {
	c := New(fakeClient{err: grpcserver.InvalidArgument(grpcserver.Violation("size_bytes", "The file is larger than the limit of 50 MiB"))})
	_, err := c.Create(t.Context(), app.NewUpload{})
	var invalid *app.InvalidUploadError
	if !errors.As(err, &invalid) || len(invalid.Violations) != 1 ||
		invalid.Violations[0] != (app.FieldViolation{Field: "size_bytes", Description: "The file is larger than the limit of 50 MiB"}) {
		t.Fatalf("err = %v, want the violation", err)
	}
}

func TestOtherPeerErrorsMatchNoApplicationError(t *testing.T) {
	c := New(fakeClient{err: status.Error(codes.NotFound, "no such document")})
	err := c.MarkUploaded(t.Context(), uuid.New())
	if err == nil || errors.Is(err, app.ErrNotFound) || errors.Is(err, app.ErrUploadMissing) || errors.Is(err, app.ErrDocumentsUnavailable) {
		t.Fatalf("err = %v", err)
	}
}

func TestCreateRejectsAMalformedDocumentID(t *testing.T) {
	if _, err := New(fakeClient{id: "nope"}).Create(t.Context(), app.NewUpload{}); err == nil {
		t.Fatal("want an error")
	}
}

func TestMarkUploadedSucceeds(t *testing.T) {
	if err := New(fakeClient{}).MarkUploaded(t.Context(), uuid.New()); err != nil {
		t.Fatal(err)
	}
}

func (f fakeClient) ReplaceContent(_ context.Context, req *documentv1.ReplaceContentRequest, _ ...grpc.CallOption) (*documentv1.ReplaceContentResponse, error) {
	if f.err != nil {
		return nil, f.err
	}
	return &documentv1.ReplaceContentResponse{
		Document:  &documentv1.Document{Id: req.GetId(), Filename: "old.md", PendingVersion: &documentv1.PendingVersion{Filename: "new.md", ContentType: "text/markdown"}},
		UploadUrl: "http://s3/v2",
	}, nil
}

func TestReplaceReturnsThePendingVersion(t *testing.T) {
	id := uuid.New()
	doc, err := New(fakeClient{}).Replace(t.Context(), id, app.NewUpload{Filename: "new.md"})
	if err != nil {
		t.Fatal(err)
	}
	if doc != (app.Document{ID: id, Filename: "new.md", ContentType: "text/markdown", UploadURL: "http://s3/v2"}) {
		t.Errorf("document = %+v", doc)
	}
}

func TestReplaceMapsTheDocumentModulesErrors(t *testing.T) {
	for _, tc := range []struct {
		name string
		err  error
		want error
	}{
		{"not found", status.Error(codes.NotFound, "document not found"), app.ErrDocumentNotFound},
		{"busy", grpcserver.WithDetails(codes.FailedPrecondition, "busy", grpcserver.ErrorInfo("kb.document.v1", "DOCUMENT_BUSY", nil)), app.ErrDocumentBusy},
		{"down", status.Error(codes.Unavailable, "down"), app.ErrDocumentsUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := New(fakeClient{err: tc.err}).Replace(t.Context(), uuid.New(), app.NewUpload{}); !errors.Is(err, tc.want) {
				t.Errorf("err = %v, want %v", err, tc.want)
			}
		})
	}
	// A violation of the document's id is about the request's document_id.
	_, err := New(fakeClient{err: grpcserver.InvalidArgument(grpcserver.Violation("id", "Invalid id"))}).Replace(t.Context(), uuid.New(), app.NewUpload{})
	var invalid *app.InvalidUploadError
	if !errors.As(err, &invalid) || invalid.Violations[0].Field != "document_id" {
		t.Errorf("err = %v", err)
	}
}
