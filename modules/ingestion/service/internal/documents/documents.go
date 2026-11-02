// Package documents adapts the document module's gRPC client to app.Documents.
package documents

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	documentv1 "github.com/christoph/kb/modules/document/api/go/documentv1"
	"github.com/christoph/kb/modules/ingestion/service/internal/app"
)

// Client implements app.Documents.
type Client struct {
	client documentv1.DocumentServiceClient
}

func New(client documentv1.DocumentServiceClient) *Client {
	return &Client{client: client}
}

func (c *Client) Create(ctx context.Context, upload app.NewUpload) (app.Document, error) {
	created, err := c.client.CreateDocument(ctx, &documentv1.CreateDocumentRequest{
		Title:       upload.Title,
		Filename:    upload.Filename,
		ContentType: upload.ContentType,
		SizeBytes:   upload.SizeBytes,
	})
	if err != nil {
		return app.Document{}, peerError("create document", err)
	}
	doc := created.GetDocument()
	id, err := uuid.Parse(doc.GetId())
	if err != nil {
		return app.Document{}, fmt.Errorf("create document: %w", err)
	}
	return app.Document{
		ID:          id,
		Filename:    doc.GetFilename(),
		ContentType: doc.GetContentType(),
		UploadURL:   created.GetUploadUrl(),
	}, nil
}

func (c *Client) MarkUploaded(ctx context.Context, id uuid.UUID) error {
	_, err := c.client.SetDocumentStatus(ctx, &documentv1.SetDocumentStatusRequest{
		Id: id.String(), Status: documentv1.DocumentStatus_DOCUMENT_STATUS_UPLOADED,
	})
	if status.Code(err) == codes.FailedPrecondition {
		return app.ErrUploadMissing
	}
	return peerError("mark document uploaded", err)
}

// peerError keeps the peer's status from reaching callers of this module: a
// document NOT_FOUND must not look like a job NOT_FOUND.
func peerError(op string, err error) error {
	if err == nil {
		return nil
	}
	if code := status.Code(err); code == codes.Unavailable || code == codes.DeadlineExceeded {
		return errors.Join(app.ErrDocumentsUnavailable, fmt.Errorf("%s: %w", op, err))
	}
	return fmt.Errorf("%s: %w", op, err)
}
