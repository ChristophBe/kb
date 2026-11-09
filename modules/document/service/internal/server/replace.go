package server

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"path"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	documentv1 "github.com/christoph/kb/modules/document/api/go/documentv1"
	"github.com/christoph/kb/modules/document/service/internal/store"
	"github.com/christoph/kb/platform/go/grpcserver"
)

// A pending version is a new file for an existing document (ReplaceContent).
// Until it has been processed the document stays as it was, so it can still
// be read, downloaded and searched: the pipeline's status changes apply to
// the pending version, ReadContent hands out its file, and only AddChunks
// makes it the current version (store.Repo.ReplaceChunks), after which the
// previous file is removed. A pending version that fails stays, FAILED, with
// its file, so that reprocessing can retry it; the document keeps its current
// version meanwhile.

// ReplaceContent starts a new version of the calling user's document: the
// file is checked against the limits like CreateDocument's, and the upload URL
// only takes the declared size and type. Ingestion calls it for the user.
func (s *Server) ReplaceContent(ctx context.Context, req *documentv1.ReplaceContentRequest) (*documentv1.ReplaceContentResponse, error) {
	owner, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	id, err := parseID("id", req.GetId())
	if err != nil {
		return nil, err
	}
	contentType := declaredContentType(req.GetContentType(), req.GetFilename())
	checksum := strings.ToLower(strings.TrimSpace(req.GetSha256()))
	var violations []*errdetails.BadRequest_FieldViolation
	if req.GetFilename() == "" {
		violations = append(violations, grpcserver.Violation("filename", "A filename is required"))
	}
	violations = append(violations, s.limits.validateUpload(req.GetSizeBytes(), contentType, checksum)...)
	if len(violations) > 0 {
		return nil, grpcserver.InvalidArgument(violations...)
	}
	doc, err := s.getOwned(ctx, owner, id)
	if err != nil {
		return nil, err
	}
	if busy(doc) {
		return nil, errBusy()
	}
	// A previous pending file goes first, so a stale upload under the same key
	// can't be taken for the new one.
	if doc.PendingObjectKey != "" {
		if err := s.objects.Delete(ctx, doc.PendingObjectKey); err != nil {
			s.log.ErrorContext(ctx, "delete object", "key", doc.PendingObjectKey, "error", err)
			return nil, status.Error(codes.Unavailable, "object storage is unavailable")
		}
	}
	version := doc.Version + 1
	key := fmt.Sprintf("%s/v%d/%s", id, version, path.Base(req.GetFilename()))
	doc, err = s.repo.StartPendingVersion(ctx, store.StartPendingVersionParams{
		ID:                 id,
		OwnerID:            owner,
		PendingStatus:      int16(documentv1.DocumentStatus_DOCUMENT_STATUS_PENDING_UPLOAD),
		PendingObjectKey:   key,
		PendingFilename:    req.GetFilename(),
		PendingContentType: contentType,
		PendingSizeBytes:   req.GetSizeBytes(),
		PendingSha256:      checksum,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		// Found above, so it became busy in between.
		return nil, errBusy()
	}
	if err != nil {
		return nil, s.internal("start version", err)
	}
	uploadURL, err := s.objects.PresignPut(ctx, key, contentType, req.GetSizeBytes())
	if err != nil {
		return nil, s.internal("presign upload", err)
	}
	return &documentv1.ReplaceContentResponse{Document: toProto(doc), UploadUrl: uploadURL}, nil
}

// busy reports a document that can't take a new version yet: its first upload
// isn't through processing, or a new version is uploaded or processing.
func busy(d store.DocumentDocument) bool {
	switch documentv1.DocumentStatus(d.Status) {
	case documentv1.DocumentStatus_DOCUMENT_STATUS_READY, documentv1.DocumentStatus_DOCUMENT_STATUS_FAILED:
	default:
		return true
	}
	switch documentv1.DocumentStatus(d.PendingStatus) {
	case documentv1.DocumentStatus_DOCUMENT_STATUS_UPLOADED, documentv1.DocumentStatus_DOCUMENT_STATUS_PROCESSING:
		return true
	}
	return false
}

func errBusy() error {
	return grpcserver.WithDetails(codes.FailedPrecondition, "the document is still being uploaded or processed",
		grpcserver.ErrorInfo(domain, "DOCUMENT_BUSY", nil))
}

// pending reports whether the document has a pending version.
func pending(d store.DocumentDocument) bool {
	return d.PendingStatus != int16(documentv1.DocumentStatus_DOCUMENT_STATUS_UNSPECIFIED)
}

// contentKey is the object ReadContent serves: the pending version's once its
// file has arrived, the current one's otherwise.
func contentKey(d store.DocumentDocument) string {
	if pending(d) && d.PendingStatus != int16(documentv1.DocumentStatus_DOCUMENT_STATUS_PENDING_UPLOAD) {
		return d.PendingObjectKey
	}
	return d.ObjectKey
}

// markPendingUploaded is markUploaded for a pending version. A rejected file
// fails only the pending version and is removed; the document keeps its
// current one.
func (s *Server) markPendingUploaded(ctx context.Context, doc store.DocumentDocument, req *documentv1.SetDocumentStatusRequest) (*documentv1.SetDocumentStatusResponse, error) {
	size, contentType, rejection, err := s.inspectUpload(ctx, doc.PendingObjectKey, doc.PendingSha256)
	if err != nil {
		return nil, err
	}
	if rejection != "" {
		if _, err := s.repo.SetPendingStatus(ctx, store.SetPendingStatusParams{
			ID: doc.ID, PendingStatus: int16(documentv1.DocumentStatus_DOCUMENT_STATUS_FAILED), PendingStatusDetail: rejection,
		}); err != nil {
			return nil, s.notFoundOr("fail version", err)
		}
		if err := s.objects.Delete(ctx, doc.PendingObjectKey); err != nil {
			s.log.WarnContext(ctx, "delete rejected object", "key", doc.PendingObjectKey, "error", err)
		}
		return nil, errRejected(rejection)
	}
	if isGenericContentType(contentType) {
		contentType = doc.PendingContentType
	}
	doc, err = s.repo.MarkPendingUploaded(ctx, store.MarkPendingUploadedParams{
		ID: doc.ID, PendingStatus: int16(req.GetStatus()), PendingStatusDetail: req.GetStatusDetail(),
		PendingSizeBytes: size, PendingContentType: contentType,
	})
	if err != nil {
		return nil, s.notFoundOr("mark uploaded", err)
	}
	return &documentv1.SetDocumentStatusResponse{Document: toProto(doc)}, nil
}

// inspectUpload checks an uploaded object against the limits and the declared
// checksum. It returns the object's size and type, or the reason to reject it
// for the user.
func (s *Server) inspectUpload(ctx context.Context, key, declaredSHA string) (size int64, contentType, rejection string, err error) {
	size, contentType, err = s.objects.Stat(ctx, key)
	if errors.Is(err, fs.ErrNotExist) {
		return 0, "", "", status.Error(codes.FailedPrecondition, "the file has not been uploaded")
	}
	if err != nil {
		s.log.ErrorContext(ctx, "stat object", "key", key, "error", err)
		return 0, "", "", status.Error(codes.Unavailable, "object storage is unavailable")
	}
	if size > s.limits.MaxUploadBytes {
		return 0, "", fmt.Sprintf("The file is larger than the limit of %s", formatBytes(s.limits.MaxUploadBytes)), nil
	}
	if declaredSHA != "" {
		actual, err := s.checksum(ctx, key)
		if err != nil {
			return 0, "", "", err
		}
		if actual != declaredSHA {
			return 0, "", "The uploaded file does not match its checksum", nil
		}
	}
	return size, contentType, "", nil
}

func errRejected(reason string) error {
	return grpcserver.WithDetails(codes.FailedPrecondition, reason, grpcserver.ErrorInfo(domain, "UPLOAD_REJECTED", nil))
}

// removeSuperseded removes the file a processed pending version replaced.
// before is the document as it was before AddChunks.
func (s *Server) removeSuperseded(ctx context.Context, before store.DocumentDocument) {
	switch documentv1.DocumentStatus(before.PendingStatus) {
	case documentv1.DocumentStatus_DOCUMENT_STATUS_UPLOADED, documentv1.DocumentStatus_DOCUMENT_STATUS_PROCESSING:
	default:
		return
	}
	if before.ObjectKey == before.PendingObjectKey {
		return
	}
	if err := s.objects.Delete(ctx, before.ObjectKey); err != nil {
		// The new version is in place; the old file is only left over.
		s.log.WarnContext(ctx, "delete superseded object", "key", before.ObjectKey, "error", err)
	}
}

// pendingProto is the document's pending version, or nil.
func pendingProto(d store.DocumentDocument) *documentv1.PendingVersion {
	if !pending(d) {
		return nil
	}
	return &documentv1.PendingVersion{
		Version:      d.Version + 1,
		Filename:     d.PendingFilename,
		ContentType:  d.PendingContentType,
		SizeBytes:    d.PendingSizeBytes,
		Status:       documentv1.DocumentStatus(d.PendingStatus),
		StatusDetail: d.PendingStatusDetail,
		Sha256:       d.PendingSha256,
	}
}

// setPendingStatus applies a status change to the document's pending version.
// It reports false when there is none.
func (s *Server) setPendingStatus(ctx context.Context, id uuid.UUID, req *documentv1.SetDocumentStatusRequest) (*documentv1.SetDocumentStatusResponse, bool, error) {
	doc, err := s.repo.SetPendingStatus(ctx, store.SetPendingStatusParams{
		ID: id, PendingStatus: int16(req.GetStatus()), PendingStatusDetail: req.GetStatusDetail(),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, true, s.internal("set status", err)
	}
	return &documentv1.SetDocumentStatusResponse{Document: toProto(doc)}, true, nil
}
