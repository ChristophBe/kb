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
