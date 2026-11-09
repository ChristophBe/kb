// Package documents adapts the document module's gRPC client to app.Documents.
package documents

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	documentv1 "github.com/christoph/kb/modules/document/api/go/documentv1"
	"github.com/christoph/kb/modules/ingestion/service/internal/app"
	"github.com/christoph/kb/platform/go/grpcserver"
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
		Sha256:      upload.SHA256,
	})
	if violations := grpcserver.FieldViolations(err); status.Code(err) == codes.InvalidArgument && len(violations) > 0 {
		// The request's fields are named as in CreateUploadRequest, so the
		// violations pass on unchanged.
		invalid := &app.InvalidUploadError{}
		for _, v := range violations {
			invalid.Violations = append(invalid.Violations, app.FieldViolation{Field: v.GetField(), Description: v.GetDescription()})
		}
		return app.Document{}, invalid
	}
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

func (c *Client) Replace(ctx context.Context, id uuid.UUID, upload app.NewUpload) (app.Document, error) {
	replaced, err := c.client.ReplaceContent(ctx, &documentv1.ReplaceContentRequest{
		Id:          id.String(),
		Filename:    upload.Filename,
		ContentType: upload.ContentType,
		SizeBytes:   upload.SizeBytes,
		Sha256:      upload.SHA256,
	})
	if violations := grpcserver.FieldViolations(err); status.Code(err) == codes.InvalidArgument && len(violations) > 0 {
		// Named as in ReplaceUploadRequest, but for the document's id.
		invalid := &app.InvalidUploadError{}
		for _, v := range violations {
			field := v.GetField()
			if field == "id" {
				field = "document_id"
			}
			invalid.Violations = append(invalid.Violations, app.FieldViolation{Field: field, Description: v.GetDescription()})
		}
		return app.Document{}, invalid
	}
	switch {
	case status.Code(err) == codes.NotFound:
		return app.Document{}, app.ErrDocumentNotFound
	case status.Code(err) == codes.FailedPrecondition && hasReason(err, "DOCUMENT_BUSY"):
		return app.Document{}, app.ErrDocumentBusy
	case err != nil:
		return app.Document{}, peerError("replace content", err)
	}
	pending := replaced.GetDocument().GetPendingVersion()
	return app.Document{
		ID:          id,
		Filename:    pending.GetFilename(),
		ContentType: pending.GetContentType(),
		UploadURL:   replaced.GetUploadUrl(),
	}, nil
}

func (c *Client) MarkUploaded(ctx context.Context, id uuid.UUID) error {
	_, err := c.client.SetDocumentStatus(ctx, &documentv1.SetDocumentStatusRequest{
		Id: id.String(), Status: documentv1.DocumentStatus_DOCUMENT_STATUS_UPLOADED,
	})
	if status.Code(err) == codes.FailedPrecondition {
		if hasReason(err, "UPLOAD_REJECTED") {
			return &app.UploadRejectedError{Reason: status.Convert(err).Message()}
		}
		return app.ErrUploadMissing
	}
	return peerError("mark document uploaded", err)
}

// hasReason reports whether err carries an ErrorInfo of the document module
// with this reason.
func hasReason(err error, reason string) bool {
	for _, d := range status.Convert(err).Details() {
		if info, ok := d.(*errdetails.ErrorInfo); ok && info.GetDomain() == "kb.document.v1" && info.GetReason() == reason {
			return true
		}
	}
	return false
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
