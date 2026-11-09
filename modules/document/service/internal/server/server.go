// Package server implements kb.document.v1.DocumentService.
package server

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"path"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pgvector/pgvector-go"
	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	documentv1 "github.com/christoph/kb/modules/document/api/go/documentv1"
	"github.com/christoph/kb/modules/document/service/internal/store"
	llmv1 "github.com/christoph/kb/modules/llm/api/go/llmv1"
	commonv1 "github.com/christoph/kb/platform/api/go/commonv1"
	"github.com/christoph/kb/platform/go/grpcserver"
)

const (
	defaultPageSize = 50
	maxPageSize     = 200
	defaultLimit    = 5
	maxLimit        = 50
	readChunkSize   = 64 << 10
	// maxTitleLength matches the limit on conversation titles in the chat module.
	maxTitleLength = 200
	// domain is the ErrorInfo domain of this module's errors.
	domain = "kb.document.v1"
)

// Repository is the persistence the server needs.
type Repository interface {
	store.Querier
	ReplaceChunks(ctx context.Context, documentID uuid.UUID, chunks []store.InsertChunksParams, readyStatus int16) (int32, error)
}

// ObjectStore holds the raw files.
type ObjectStore interface {
	// PresignPut returns an upload URL that only takes a file of exactly
	// size bytes sent with this content type.
	PresignPut(ctx context.Context, key, contentType string, size int64) (string, error)
	PresignGet(ctx context.Context, key, filename string) (string, error)
	Open(ctx context.Context, key string) (io.ReadCloser, error)
	// Stat returns an object's size and content type, or an error wrapping
	// fs.ErrNotExist when it is missing.
	Stat(ctx context.Context, key string) (size int64, contentType string, err error)
	Delete(ctx context.Context, key string) error
}

// Server implements DocumentService. Documents belong to the user who uploaded
// them: the RPCs a user calls, and the internal CreateDocument and SearchChunks
// that services call on a user's behalf (passing the user on), act on that
// user's documents only and report another user's as not found. The other
// internal RPCs serve the ingestion pipeline, which runs without a user, and
// act on any document.
type Server struct {
	documentv1.UnimplementedDocumentServiceServer
	repo    Repository
	objects ObjectStore
	llm     llmv1.LlmServiceClient
	limits  Limits
	log     *slog.Logger
}

// New builds the server. llm is the llm module's client, used only by
// SearchDocuments; it may point at a service that is down. limits bound the
// files users upload.
func New(repo Repository, objects ObjectStore, llm llmv1.LlmServiceClient, limits Limits, log *slog.Logger) *Server {
	return &Server{repo: repo, objects: objects, llm: llm, limits: limits, log: log}
}

// CreateDocument registers a document owned by the calling user, so it is
// called on behalf of a user (ingestion forwards the uploader). The file must
// fit the limits; the upload URL only takes the declared size and type.
func (s *Server) CreateDocument(ctx context.Context, req *documentv1.CreateDocumentRequest) (*documentv1.CreateDocumentResponse, error) {
	owner, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	contentType := declaredContentType(req.GetContentType(), req.GetFilename())
	checksum := strings.ToLower(strings.TrimSpace(req.GetSha256()))
	var violations []*errdetails.BadRequest_FieldViolation
	if req.GetFilename() == "" {
		violations = append(violations, grpcserver.Violation("filename", "A filename is required"))
	}
	if utf8.RuneCountInString(req.GetTitle()) > maxTitleLength {
		violations = append(violations, grpcserver.Violation("title",
			fmt.Sprintf("Title must not be longer than %d characters", maxTitleLength)))
	}
	violations = append(violations, s.limits.validateUpload(req.GetSizeBytes(), contentType, checksum)...)
	if len(violations) > 0 {
		return nil, grpcserver.InvalidArgument(violations...)
	}
	id := uuid.New()
	title := req.GetTitle()
	if title == "" {
		title = req.GetFilename()
	}
	key := id.String() + "/" + path.Base(req.GetFilename())
	doc, err := s.repo.CreateDocument(ctx, store.CreateDocumentParams{
		ID:          id,
		OwnerID:     owner,
		Title:       title,
		Filename:    req.GetFilename(),
		ContentType: contentType,
		SizeBytes:   req.GetSizeBytes(),
		ObjectKey:   key,
		Status:      int16(documentv1.DocumentStatus_DOCUMENT_STATUS_PENDING_UPLOAD),
		Metadata:    nonNil(req.GetMetadata()),
		Sha256:      checksum,
	})
	if err != nil {
		return nil, s.internal("create document", err)
	}
	uploadURL, err := s.objects.PresignPut(ctx, key, contentType, req.GetSizeBytes())
	if err != nil {
		return nil, s.internal("presign upload", err)
	}
	return &documentv1.CreateDocumentResponse{Document: toProto(doc), UploadUrl: uploadURL}, nil
}

func (s *Server) GetDocument(ctx context.Context, req *documentv1.GetDocumentRequest) (*documentv1.GetDocumentResponse, error) {
	doc, err := s.get(ctx, req.GetId())
	if err != nil {
		return nil, err
	}
	return &documentv1.GetDocumentResponse{Document: toProto(doc)}, nil
}

func (s *Server) ListDocuments(ctx context.Context, req *documentv1.ListDocumentsRequest) (*documentv1.ListDocumentsResponse, error) {
	owner, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	limit, offset, err := pageParams(req.GetPage())
	if err != nil {
		return nil, err
	}
	docs, err := s.repo.ListDocuments(ctx, store.ListDocumentsParams{OwnerID: owner, Limit: limit + 1, Offset: offset})
	if err != nil {
		return nil, s.internal("list documents", err)
	}
	resp := &documentv1.ListDocumentsResponse{Page: &commonv1.PageResponse{}}
	if len(docs) > int(limit) {
		docs = docs[:limit]
		resp.Page.NextPageToken = strconv.Itoa(int(offset + limit))
	}
	for _, d := range docs {
		resp.Documents = append(resp.Documents, toProto(d))
	}
	return resp, nil
}

func (s *Server) UpdateDocument(ctx context.Context, req *documentv1.UpdateDocumentRequest) (*documentv1.UpdateDocumentResponse, error) {
	owner, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	id, err := parseID("id", req.GetId())
	if err != nil {
		return nil, err
	}
	params := store.UpdateDocumentParams{ID: id, OwnerID: owner}
	if req.Title != nil {
		title := strings.TrimSpace(req.GetTitle())
		if title == "" {
			return nil, grpcserver.InvalidArgument(grpcserver.Violation("title", "Title must not be empty"))
		}
		if utf8.RuneCountInString(title) > maxTitleLength {
			return nil, grpcserver.InvalidArgument(grpcserver.Violation("title",
				fmt.Sprintf("Title must not be longer than %d characters", maxTitleLength)))
		}
		params.Title = pgtype.Text{String: title, Valid: true}
	}
	if req.GetSetMetadata() {
		for key := range req.GetMetadata() {
			if strings.TrimSpace(key) == "" {
				return nil, grpcserver.InvalidArgument(grpcserver.Violation("metadata", "Metadata keys must not be empty"))
			}
		}
		params.Metadata = nonNil(req.GetMetadata())
	}
	doc, err := s.repo.UpdateDocument(ctx, params)
	if err != nil {
		return nil, s.notFoundOr("update document", err)
	}
	return &documentv1.UpdateDocumentResponse{Document: toProto(doc)}, nil
}

func (s *Server) DeleteDocument(ctx context.Context, req *documentv1.DeleteDocumentRequest) (*documentv1.DeleteDocumentResponse, error) {
	owner, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	id, err := parseID("id", req.GetId())
	if err != nil {
		return nil, err
	}
	key, err := s.repo.DeleteDocument(ctx, store.DeleteDocumentParams{ID: id, OwnerID: owner})
	if err != nil {
		return nil, s.notFoundOr("delete document", err)
	}
	if err := s.objects.Delete(ctx, key); err != nil {
		// The row is gone; an orphaned object is harmless, so only log it.
		s.log.WarnContext(ctx, "delete object", "key", key, "error", err)
	}
	return &documentv1.DeleteDocumentResponse{}, nil
}

func (s *Server) SetDocumentStatus(ctx context.Context, req *documentv1.SetDocumentStatusRequest) (*documentv1.SetDocumentStatusResponse, error) {
	id, err := parseID("id", req.GetId())
	if err != nil {
		return nil, err
	}
	if req.GetStatus() == documentv1.DocumentStatus_DOCUMENT_STATUS_UNSPECIFIED {
		return nil, grpcserver.InvalidArgument(grpcserver.Violation("status", "A status is required"))
	}
	if req.GetStatus() == documentv1.DocumentStatus_DOCUMENT_STATUS_UPLOADED {
		return s.markUploaded(ctx, id, req)
	}
	doc, err := s.repo.SetDocumentStatus(ctx, store.SetDocumentStatusParams{
		ID: id, Status: int16(req.GetStatus()), StatusDetail: req.GetStatusDetail(),
	})
	if err != nil {
		return nil, s.notFoundOr("set status", err)
	}
	return &documentv1.SetDocumentStatusResponse{Document: toProto(doc)}, nil
}

// markUploaded trusts the bucket, not the client: the object must exist, and
// its actual size replaces the size declared when the upload was created. An
// object over the size limit or not matching the declared checksum fails the
// document. The upload URL already enforces the declared size; checking here
// as well keeps the limit with any S3 server and for objects put there by
// other means.
func (s *Server) markUploaded(ctx context.Context, id uuid.UUID, req *documentv1.SetDocumentStatusRequest) (*documentv1.SetDocumentStatusResponse, error) {
	doc, err := s.repo.GetAnyDocument(ctx, id)
	if err != nil {
		return nil, s.notFoundOr("get document", err)
	}
	size, contentType, err := s.objects.Stat(ctx, doc.ObjectKey)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, status.Error(codes.FailedPrecondition, "the file has not been uploaded")
	}
	if err != nil {
		s.log.ErrorContext(ctx, "stat object", "key", doc.ObjectKey, "error", err)
		return nil, status.Error(codes.Unavailable, "object storage is unavailable")
	}
	if size > s.limits.MaxUploadBytes {
		return nil, s.reject(ctx, id, fmt.Sprintf("The file is larger than the limit of %s", formatBytes(s.limits.MaxUploadBytes)))
	}
	if doc.Sha256 != "" {
		actual, err := s.checksum(ctx, doc.ObjectKey)
		if err != nil {
			return nil, err
		}
		if actual != doc.Sha256 {
			return nil, s.reject(ctx, id, "The uploaded file does not match its checksum")
		}
	}
	if isGenericContentType(contentType) {
		contentType = doc.ContentType
	}
	doc, err = s.repo.MarkDocumentUploaded(ctx, store.MarkDocumentUploadedParams{
		ID: id, Status: int16(req.GetStatus()), StatusDetail: req.GetStatusDetail(), SizeBytes: size, ContentType: contentType,
	})
	if err != nil {
		return nil, s.notFoundOr("mark uploaded", err)
	}
	return &documentv1.SetDocumentStatusResponse{Document: toProto(doc)}, nil
}

// checksum hashes the stored object.
func (s *Server) checksum(ctx context.Context, key string) (string, error) {
	r, err := s.objects.Open(ctx, key)
	if err != nil {
		s.log.ErrorContext(ctx, "open object", "key", key, "error", err)
		return "", status.Error(codes.Unavailable, "object storage is unavailable")
	}
	defer r.Close()
	sum, err := sha256Hex(r)
	if err != nil {
		s.log.ErrorContext(ctx, "read object", "key", key, "error", err)
		return "", status.Error(codes.Unavailable, "object storage is unavailable")
	}
	return sum, nil
}

// reject fails a document whose uploaded file is not acceptable, recording
// why, and returns the error SetDocumentStatus answers with.
func (s *Server) reject(ctx context.Context, id uuid.UUID, reason string) error {
	if _, err := s.repo.SetDocumentStatus(ctx, store.SetDocumentStatusParams{
		ID: id, Status: int16(documentv1.DocumentStatus_DOCUMENT_STATUS_FAILED), StatusDetail: reason,
	}); err != nil {
		return s.notFoundOr("fail document", err)
	}
	return grpcserver.WithDetails(codes.FailedPrecondition, reason, grpcserver.ErrorInfo(domain, "UPLOAD_REJECTED", nil))
}

func (s *Server) GetDownloadUrl(ctx context.Context, req *documentv1.GetDownloadUrlRequest) (*documentv1.GetDownloadUrlResponse, error) {
	doc, err := s.get(ctx, req.GetId())
	if err != nil {
		return nil, err
	}
	u, err := s.objects.PresignGet(ctx, doc.ObjectKey, doc.Filename)
	if err != nil {
		return nil, s.internal("presign download", err)
	}
	return &documentv1.GetDownloadUrlResponse{Url: u}, nil
}

func (s *Server) ReadContent(req *documentv1.ReadContentRequest, stream documentv1.DocumentService_ReadContentServer) error {
	ctx := stream.Context()
	id, err := parseID("id", req.GetId())
	if err != nil {
		return err
	}
	doc, err := s.repo.GetAnyDocument(ctx, id)
	if err != nil {
		return s.notFoundOr("get document", err)
	}
	r, err := s.objects.Open(ctx, doc.ObjectKey)
	if err != nil {
		return s.internal("open object", err)
	}
	defer r.Close()
	buf := make([]byte, readChunkSize)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			if serr := stream.Send(&documentv1.ReadContentResponse{Data: buf[:n]}); serr != nil {
				return serr
			}
		}
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return s.internal("read object", err)
		}
	}
}

func (s *Server) AddChunks(ctx context.Context, req *documentv1.AddChunksRequest) (*documentv1.AddChunksResponse, error) {
	id, err := parseID("document_id", req.GetDocumentId())
	if err != nil {
		return nil, err
	}
	rows := make([]store.InsertChunksParams, 0, len(req.GetChunks()))
	for i, c := range req.GetChunks() {
		if len(c.GetEmbedding()) == 0 {
			return nil, grpcserver.InvalidArgument(grpcserver.Violation(fmt.Sprintf("chunks[%d].embedding", i),
				fmt.Sprintf("Chunk %d has no embedding", c.GetIndex())))
		}
		rows = append(rows, store.InsertChunksParams{
			DocumentID: id,
			Idx:        c.GetIndex(),
			Text:       c.GetText(),
			Metadata:   nonNil(c.GetMetadata()),
			Embedding:  pgvector.NewVector(c.GetEmbedding()),
		})
	}
	n, err := s.repo.ReplaceChunks(ctx, id, rows, int16(documentv1.DocumentStatus_DOCUMENT_STATUS_READY))
	if err != nil {
		return nil, s.internal("replace chunks", err)
	}
	return &documentv1.AddChunksResponse{ChunkCount: n}, nil
}

// ListChunks pages through a document's chunks by index. The page token is
// the last index of the previous page, so pages stay stable while the client
// pages; a document re-processed in between simply continues after that index.
func (s *Server) ListChunks(ctx context.Context, req *documentv1.ListChunksRequest) (*documentv1.ListChunksResponse, error) {
	owner, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	id, err := parseID("document_id", req.GetDocumentId())
	if err != nil {
		return nil, err
	}
	after, err := decodeChunkToken(req.GetPage().GetPageToken())
	if err != nil {
		return nil, err
	}
	limit := pageSize(req.GetPage())
	if _, err := s.getOwned(ctx, owner, id); err != nil {
		return nil, err
	}
	rows, err := s.repo.ListChunks(ctx, store.ListChunksParams{DocumentID: id, AfterIdx: after, MaxResults: limit + 1})
	if err != nil {
		return nil, s.internal("list chunks", err)
	}
	resp := &documentv1.ListChunksResponse{Page: &commonv1.PageResponse{}}
	if len(rows) > int(limit) {
		rows = rows[:limit]
		resp.Page.NextPageToken = encodeChunkToken(rows[len(rows)-1].Idx)
	}
	for _, r := range rows {
		resp.Chunks = append(resp.Chunks, &documentv1.Chunk{
			DocumentId: r.DocumentID.String(), Index: r.Idx, Text: r.Text, Metadata: r.Metadata,
		})
	}
	return resp, nil
}

// SearchChunks searches the calling user's chunks; chat calls it on behalf of
// the user asking.
func (s *Server) SearchChunks(ctx context.Context, req *documentv1.SearchChunksRequest) (*documentv1.SearchChunksResponse, error) {
	owner, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if len(req.GetEmbedding()) == 0 {
		return nil, grpcserver.InvalidArgument(grpcserver.Violation("embedding", "An embedding is required"))
	}
	ids, err := parseIDs(req.GetDocumentIds())
	if err != nil {
		return nil, err
	}
	results, err := s.search(ctx, owner, req.GetEmbedding(), req.GetLimit(), ids)
	if err != nil {
		return nil, err
	}
	return &documentv1.SearchChunksResponse{Results: results}, nil
}

// SearchDocuments embeds the query through the llm module, then runs the same
// vector search as SearchChunks and ranks documents by their best chunk; limit
// counts documents. Only this RPC needs llm: while it is down, this fails with
// UNAVAILABLE and every other RPC keeps working.
func (s *Server) SearchDocuments(ctx context.Context, req *documentv1.SearchDocumentsRequest) (*documentv1.SearchDocumentsResponse, error) {
	owner, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	query := strings.TrimSpace(req.GetQuery())
	if query == "" {
		return nil, grpcserver.InvalidArgument(grpcserver.Violation("query", "A query is required"))
	}
	ids, err := parseIDs(req.GetDocumentIds())
	if err != nil {
		return nil, err
	}
	embedded, err := s.llm.Embed(ctx, &llmv1.EmbedRequest{Inputs: []string{query}})
	if err != nil {
		// llm's own statuses mean something else here; only its availability
		// is passed on.
		if code := status.Code(err); code == codes.Unavailable || code == codes.DeadlineExceeded {
			s.log.WarnContext(ctx, "embed query", "error", err)
			return nil, status.Error(codes.Unavailable, "the llm service is unavailable")
		}
		return nil, s.internal("embed query", err)
	}
	if len(embedded.GetEmbeddings()) != 1 || len(embedded.GetEmbeddings()[0].GetValues()) == 0 {
		return nil, s.internal("embed query", fmt.Errorf("got %d embeddings for 1 input", len(embedded.GetEmbeddings())))
	}
	embedding := embedded.GetEmbeddings()[0].GetValues()
	results, err := s.search(ctx, owner, embedding, req.GetLimit(), ids)
	if err != nil {
		return nil, err
	}
	rows, err := s.repo.SearchBestChunks(ctx, store.SearchBestChunksParams{
		Embedding: pgvector.NewVector(embedding), OwnerID: owner, DocumentIds: ids, MaxResults: clampLimit(req.GetLimit()),
	})
	if err != nil {
		return nil, s.internal("search documents", err)
	}
	documents := make([]*documentv1.ScoredDocument, 0, len(rows))
	for _, r := range rows {
		documents = append(documents, &documentv1.ScoredDocument{
			DocumentId: r.DocumentID.String(),
			Title:      r.DocumentTitle,
			Score:      r.Score,
			BestChunk: &documentv1.Chunk{
				DocumentId: r.DocumentID.String(), Index: r.Idx, Text: r.Text, Metadata: r.Metadata,
			},
		})
	}
	return &documentv1.SearchDocumentsResponse{Results: results, Documents: documents}, nil
}

// clampLimit applies the default and the cap to a search's limit.
func clampLimit(limit int32) int32 {
	if limit <= 0 {
		return defaultLimit
	}
	return min(limit, maxLimit)
}

func (s *Server) search(ctx context.Context, owner string, embedding []float32, limit int32, ids []uuid.UUID) ([]*documentv1.ScoredChunk, error) {
	rows, err := s.repo.SearchChunks(ctx, store.SearchChunksParams{
		Embedding: pgvector.NewVector(embedding), OwnerID: owner, DocumentIds: ids, MaxResults: clampLimit(limit),
	})
	if err != nil {
		return nil, s.internal("search chunks", err)
	}
	results := make([]*documentv1.ScoredChunk, 0, len(rows))
	for _, r := range rows {
		results = append(results, &documentv1.ScoredChunk{
			Chunk: &documentv1.Chunk{
				DocumentId: r.DocumentID.String(), Index: r.Idx, Text: r.Text, Metadata: r.Metadata,
			},
			DocumentTitle: r.DocumentTitle,
			Score:         r.Score,
		})
	}
	return results, nil
}

// get returns the calling user's document with the id in the request.
func (s *Server) get(ctx context.Context, rawID string) (store.DocumentDocument, error) {
	owner, err := caller(ctx)
	if err != nil {
		return store.DocumentDocument{}, err
	}
	id, err := parseID("id", rawID)
	if err != nil {
		return store.DocumentDocument{}, err
	}
	return s.getOwned(ctx, owner, id)
}

// getOwned returns owner's document; another user's is not found.
func (s *Server) getOwned(ctx context.Context, owner string, id uuid.UUID) (store.DocumentDocument, error) {
	doc, err := s.repo.GetDocument(ctx, store.GetDocumentParams{ID: id, OwnerID: owner})
	if err != nil {
		return store.DocumentDocument{}, s.notFoundOr("get document", err)
	}
	return doc, nil
}

// caller returns the user the call is made for. Calls through the gateway
// always carry one, and services pass it on when calling for a user.
func caller(ctx context.Context) (string, error) {
	user, ok := grpcserver.UserFromContext(ctx)
	if !ok {
		return "", status.Error(codes.Unauthenticated, "the call has no user")
	}
	return user, nil
}

func (s *Server) notFoundOr(op string, err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return status.Error(codes.NotFound, "document not found")
	}
	return s.internal(op, err)
}

func (s *Server) internal(op string, err error) error {
	s.log.Error(op, "error", err)
	return status.Errorf(codes.Internal, "%s failed", op)
}

// parseID parses the id in the request field named field.
func parseID(field, raw string) (uuid.UUID, error) {
	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, grpcserver.InvalidArgument(grpcserver.Violation(field, fmt.Sprintf("Invalid id %q", raw)))
	}
	return id, nil
}

func parseIDs(raw []string) ([]uuid.UUID, error) {
	ids := make([]uuid.UUID, 0, len(raw))
	for i, r := range raw {
		id, err := parseID(fmt.Sprintf("document_ids[%d]", i), r)
		if err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, nil
}

func pageSize(p *commonv1.PageRequest) int32 {
	if n := p.GetPageSize(); n > 0 {
		return min(n, maxPageSize)
	}
	return defaultPageSize
}

func pageParams(p *commonv1.PageRequest) (limit, offset int32, err error) {
	limit = pageSize(p)
	if tok := p.GetPageToken(); tok != "" {
		o, perr := strconv.Atoi(tok)
		if perr != nil || o < 0 {
			return 0, 0, errInvalidPageToken()
		}
		offset = int32(o)
	}
	return limit, offset, nil
}

// encodeChunkToken makes the last index of a page an opaque cursor.
func encodeChunkToken(idx int32) string {
	return base64.RawURLEncoding.EncodeToString([]byte(strconv.Itoa(int(idx))))
}

// decodeChunkToken returns the index to continue after; -1 for the first page.
func decodeChunkToken(tok string) (int32, error) {
	if tok == "" {
		return -1, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(tok)
	if err != nil {
		return 0, errInvalidPageToken()
	}
	idx, err := strconv.ParseInt(string(raw), 10, 32)
	if err != nil || idx < 0 {
		return 0, errInvalidPageToken()
	}
	return int32(idx), nil
}

func errInvalidPageToken() error {
	return grpcserver.InvalidArgument(grpcserver.Violation("page.page_token", "The page token is invalid"))
}

// isGenericContentType reports a type that says nothing about the content:
// S3 stores one of these when a client uploads without a Content-Type.
func isGenericContentType(contentType string) bool {
	switch contentType {
	case "", "application/octet-stream", "binary/octet-stream":
		return true
	}
	return false
}

func nonNil(m map[string]string) map[string]string {
	if m == nil {
		return map[string]string{}
	}
	return m
}

func toProto(d store.DocumentDocument) *documentv1.Document {
	return &documentv1.Document{
		Id:           d.ID.String(),
		Title:        d.Title,
		Filename:     d.Filename,
		ContentType:  d.ContentType,
		SizeBytes:    d.SizeBytes,
		Status:       documentv1.DocumentStatus(d.Status),
		StatusDetail: d.StatusDetail,
		ChunkCount:   d.ChunkCount,
		Metadata:     d.Metadata,
		CreateTime:   timestamppb.New(d.CreatedAt.Time),
		UpdateTime:   timestamppb.New(d.UpdatedAt.Time),
		OwnerId:      d.OwnerID,
		Sha256:       d.Sha256,
	}
}
